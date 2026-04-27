import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { appEvents } from './event-emitter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamProcess {
  cameraId: string;
  organizationId: string;
  process: ChildProcess;
  pid: number | undefined;
  startedAt: Date;
  restartCount: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  recordingId: string | null;
  liveDir: string;
  recordDir: string;
  stopping: boolean;
  streamUrl: string;
}

export interface StreamInfo {
  cameraId: string;
  pid: number | undefined;
  startedAt: Date;
  restartCount: number;
  livePlaylistUrl: string;
  recordDir: string;
  isStreaming: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESTART_RETRIES = 5;
const BASE_RESTART_DELAY_MS = 2_000; // 2 seconds, doubles each retry
const DATA_DIR = path.join(process.cwd(), 'data');
const STREAMS_DIR = path.join(DATA_DIR, 'streams');
const DEFAULT_RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');

/** Get recordings directory for an organization (custom or default). */
async function getRecordingsDir(organizationId: string): Promise<string> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storagePath: true },
    });
    if (org?.storagePath) return org.storagePath;
  } catch { /* fallback to default */ }
  return DEFAULT_RECORDINGS_DIR;
}

// ---------------------------------------------------------------------------
// StreamManager — singleton
// ---------------------------------------------------------------------------

class StreamManager {
  private static instance: StreamManager;
  private streams = new Map<string, StreamProcess>();
  private shuttingDown = false;

  private constructor() {
    // Register graceful shutdown handlers once
    const onExit = () => void this.shutdownAll();
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
  }

  static getInstance(): StreamManager {
    if (!StreamManager.instance) {
      StreamManager.instance = new StreamManager();
    }
    return StreamManager.instance;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start live HLS streaming + archive recording for a camera.
   *  @param streamUrlOverride — optional RTSP proxy URL (e.g. go2rtc) to avoid extra RTSP sessions */
  async startStream(cameraId: string, streamUrlOverride?: string): Promise<StreamInfo> {
    // Already streaming — return existing info
    if (this.streams.has(cameraId)) {
      const existing = this.streams.get(cameraId)!;
      if (!existing.stopping) {
        console.log(`[StreamManager] Camera ${cameraId} is already streaming`);
        return this.buildStreamInfo(existing);
      }
      // If currently stopping, wait a moment then proceed
      await this.waitForStop(cameraId, 5_000);
    }

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) {
      throw new Error(`Camera ${cameraId} not found`);
    }
    if (!camera.streamUrl) {
      throw new Error(`Camera ${cameraId} has no stream URL configured`);
    }

    // Prepare directories — use org-specific storage path if configured
    const recordingsBase = await getRecordingsDir(camera.organizationId);
    const liveDir = path.join(STREAMS_DIR, cameraId);
    const now = new Date();
    const dateDir = this.formatDate(now); // YYYY-MM-DD
    const hourDir = this.formatHour(now); // HH
    const recordDir = path.join(recordingsBase, cameraId, dateDir, hourDir);

    await fs.mkdir(liveDir, { recursive: true });
    await fs.mkdir(recordDir, { recursive: true });

    // Create Recording entry in DB
    const recording = await prisma.recording.create({
      data: {
        cameraId: camera.id,
        organizationId: camera.organizationId,
        segmentDir: recordDir.startsWith(DATA_DIR)
          ? path.relative(DATA_DIR, recordDir)
          : recordDir,
        status: 'recording',
      },
    });

    // Build ffmpeg args — use override URL (e.g. go2rtc RTSP proxy) to avoid extra RTSP sessions
    const effectiveStreamUrl = streamUrlOverride || camera.streamUrl;
    const ffmpegArgs = this.buildFfmpegArgs(effectiveStreamUrl, liveDir, recordDir);

    // Spawn ffmpeg
    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const streamProc: StreamProcess = {
      cameraId,
      organizationId: camera.organizationId,
      process: proc,
      pid: proc.pid,
      startedAt: now,
      restartCount: 0,
      restartTimer: null,
      recordingId: recording.id,
      liveDir,
      recordDir,
      stopping: false,
      streamUrl: effectiveStreamUrl,
    };

    this.streams.set(cameraId, streamProc);

    // Attach lifecycle handlers
    this.attachProcessHandlers(streamProc);

    // Update camera status in DB
    await prisma.camera.update({
      where: { id: cameraId },
      data: { isStreaming: true, isRecording: true, status: 'online' },
    });

    appEvents.emit('camera-event', {
      type: 'smart_alert',
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId,
      data: { action: 'stream_started', pid: proc.pid },
    });

    console.log(
      `[StreamManager] Started stream for camera ${cameraId} (PID: ${proc.pid})`
    );

    return this.buildStreamInfo(streamProc);
  }

  /** Stop streaming and recording for a camera. */
  async stopStream(cameraId: string): Promise<void> {
    const streamProc = this.streams.get(cameraId);
    if (!streamProc) {
      console.log(`[StreamManager] Camera ${cameraId} is not streaming`);
      return;
    }

    streamProc.stopping = true;

    // Clear any pending restart timer
    if (streamProc.restartTimer) {
      clearTimeout(streamProc.restartTimer);
      streamProc.restartTimer = null;
    }

    // Gracefully terminate ffmpeg (send SIGINT for clean segment finalization)
    await this.killProcess(streamProc);

    // Finalize recording in DB
    await this.finalizeRecording(streamProc);

    // Cleanup live HLS segments
    await this.cleanupLiveSegments(streamProc.liveDir);

    // Update camera status
    await prisma.camera.update({
      where: { id: cameraId },
      data: { isStreaming: false, isRecording: false },
    });

    this.streams.delete(cameraId);

    console.log(`[StreamManager] Stopped stream for camera ${cameraId}`);
  }

  /** Check if a camera is currently streaming. */
  isStreaming(cameraId: string): boolean {
    const proc = this.streams.get(cameraId);
    return !!proc && !proc.stopping;
  }

  /** Get stream info for a camera, or null if not streaming. */
  getStreamInfo(cameraId: string): StreamInfo | null {
    const proc = this.streams.get(cameraId);
    if (!proc || proc.stopping) return null;
    return this.buildStreamInfo(proc);
  }

  /** Get all currently active stream camera IDs. */
  getActiveStreams(): string[] {
    return Array.from(this.streams.entries())
      .filter(([, p]) => !p.stopping)
      .map(([id]) => id);
  }

  /** Gracefully shut down all streams (used on process exit). */
  async shutdownAll(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    console.log(
      `[StreamManager] Shutting down all streams (${this.streams.size} active)...`
    );

    const stopPromises = Array.from(this.streams.keys()).map((cameraId) =>
      this.stopStream(cameraId).catch((err) =>
        console.error(
          `[StreamManager] Error stopping stream ${cameraId} during shutdown:`,
          err
        )
      )
    );

    await Promise.allSettled(stopPromises);
    console.log('[StreamManager] All streams shut down');
  }

  // -----------------------------------------------------------------------
  // FFmpeg argument construction
  // -----------------------------------------------------------------------

  private buildFfmpegArgs(
    streamUrl: string,
    liveDir: string,
    recordDir: string
  ): string[] {
    const isHttp =
      streamUrl.startsWith('http://') || streamUrl.startsWith('https://');
    const isMjpeg = streamUrl.includes('mjpeg') || streamUrl.includes('cgi');

    // --- Input args ---
    const inputArgs: string[] = [
      '-hide_banner',
      '-loglevel', 'warning',
    ];

    if (!isHttp) {
      // RTSP input with TCP transport
      inputArgs.push(
        '-rtsp_transport', 'tcp',
        '-timeout', '5000000', // 5 seconds connection timeout (microseconds)
      );
    }

    if (isMjpeg) {
      inputArgs.push('-f', 'mjpeg');
    }

    if (isHttp) {
      // Reconnect options must come BEFORE -i for HTTP(S) streams
      inputArgs.push(
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
      );
    }

    inputArgs.push('-i', streamUrl);

    // --- Encoding args ---
    // Use -c copy (no re-encoding). Camera already emits H264/HEVC + audio
    // and we only need to remux into MPEG-TS segments. Saves ~7% CPU per
    // camera vs libx264 transcoding. Live preview goes through go2rtc/WebRTC,
    // so we drop the rolling live HLS output entirely — the archive segments
    // alone are enough.
    const encodeArgs: string[] = [
      '-c', 'copy',
      // Map video + optional audio (no error if audio absent)
      '-map', '0:v:0',
      '-map', '0:a:0?',
      // Some cameras emit non-monotonic DTS after a keyframe — fix it so
      // segments stitch cleanly.
      '-fflags', '+genpts+igndts',
      '-avoid_negative_ts', 'make_zero',
    ];

    // --- Output: archive segments (HLS recording only) ---
    const archiveSegmentPattern = path.join(recordDir, '%Y-%m-%d_%H-%M-%S.ts');
    const archivePlaylist = path.join(recordDir, 'index.m3u8');
    const archiveArgs: string[] = [
      '-f', 'segment',
      '-segment_time', '60',
      '-segment_format', 'mpegts',
      '-strftime', '1',
      '-segment_list', archivePlaylist,
      '-segment_list_type', 'm3u8',
      '-reset_timestamps', '1',
      archiveSegmentPattern,
    ];

    // liveDir kept for compatibility (existing folder may be referenced
    // elsewhere) but no live HLS ffmpeg output is written.
    void liveDir;

    return [...inputArgs, ...encodeArgs, ...archiveArgs];
  }

  // -----------------------------------------------------------------------
  // Process lifecycle
  // -----------------------------------------------------------------------

  private attachProcessHandlers(
    streamProc: StreamProcess,
  ): void {
    const { process: proc, cameraId, streamUrl } = streamProc;

    // Collect stderr for diagnostics
    let stderrBuffer = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      // Keep only the last 4KB for diagnostics
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-4096);
      }
    });

    proc.on('error', (err) => {
      console.error(
        `[StreamManager] ffmpeg spawn error for camera ${cameraId}:`,
        err.message
      );
      // If ffmpeg binary is not found, mark immediately
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(
          '[StreamManager] ffmpeg not found in PATH. Install ffmpeg to enable streaming.'
        );
        void this.handleProcessExit(streamProc, 1, streamUrl, 'ffmpeg not found');
      }
    });

    proc.on('exit', (code, signal) => {
      const reason = stderrBuffer.trim().split('\n').pop() || '';
      console.log(
        `[StreamManager] ffmpeg exited for camera ${cameraId} ` +
          `(code=${code}, signal=${signal}) — ${reason}`
      );
      void this.handleProcessExit(
        streamProc,
        code ?? 1,
        streamUrl,
        reason
      );
    });
  }

  private async handleProcessExit(
    streamProc: StreamProcess,
    exitCode: number,
    _streamUrl: string,
    reason: string
  ): Promise<void> {
    const { cameraId } = streamProc;

    // If we requested the stop, don't restart
    if (streamProc.stopping || this.shuttingDown) {
      return;
    }

    // Determine if the error is non-recoverable
    const nonRecoverable =
      reason.includes('No such file or directory') || // ffmpeg not found
      reason.includes('Permission denied') ||
      reason.includes('No space left on device') ||
      reason.includes('Invalid data found') || // corrupt/wrong stream URL
      exitCode === 127; // command not found

    if (nonRecoverable) {
      console.error(
        `[StreamManager] Non-recoverable error for camera ${cameraId}: ${reason}`
      );
      await this.markStreamFailed(streamProc, reason);
      return;
    }

    // Retry with exponential backoff — never give up, cap delay at 60s
    const MAX_DELAY_MS = 60_000;
    const delay = Math.min(
      BASE_RESTART_DELAY_MS * Math.pow(2, streamProc.restartCount),
      MAX_DELAY_MS
    );
    streamProc.restartCount++;

    // Reset retry counter after sustained success (will be reset in restartProcess on success)
    console.log(
      `[StreamManager] Restarting stream for camera ${cameraId} ` +
        `in ${delay / 1000}s (attempt ${streamProc.restartCount})`
    );

    streamProc.restartTimer = setTimeout(() => {
      void this.restartProcess(streamProc);
    }, delay);
  }

  private async restartProcess(
    streamProc: StreamProcess,
  ): Promise<void> {
    const { cameraId, liveDir, streamUrl } = streamProc;

    // Check if we were stopped while waiting for restart
    if (streamProc.stopping || this.shuttingDown) return;

    // Rotate recording directory to current hour — use org-specific storage path
    const recordingsBase = await getRecordingsDir(streamProc.organizationId);
    const now = new Date();
    const dateDir = this.formatDate(now);
    const hourDir = this.formatHour(now);
    const newRecordDir = path.join(recordingsBase, cameraId, dateDir, hourDir);

    await fs.mkdir(newRecordDir, { recursive: true });

    // Finalize old recording
    await this.finalizeRecording(streamProc);

    // Create new recording entry
    const recording = await prisma.recording.create({
      data: {
        cameraId,
        organizationId: streamProc.organizationId,
        segmentDir: newRecordDir.startsWith(DATA_DIR)
          ? path.relative(DATA_DIR, newRecordDir)
          : newRecordDir,
        status: 'recording',
      },
    });

    streamProc.recordingId = recording.id;
    streamProc.recordDir = newRecordDir;

    // Build new ffmpeg args and spawn
    const ffmpegArgs = this.buildFfmpegArgs(streamUrl, liveDir, newRecordDir);
    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    streamProc.process = proc;
    streamProc.pid = proc.pid;

    this.attachProcessHandlers(streamProc);

    // Reset retry counter on successful restart
    streamProc.restartCount = 0;

    console.log(
      `[StreamManager] Restarted stream for camera ${cameraId} (PID: ${proc.pid})`
    );
  }

  private async markStreamFailed(
    streamProc: StreamProcess,
    reason: string
  ): Promise<void> {
    const { cameraId, recordingId } = streamProc;

    // Finalize recording as error
    if (recordingId) {
      await prisma.recording
        .update({
          where: { id: recordingId },
          data: { status: 'error', endedAt: new Date() },
        })
        .catch((e) =>
          console.error(
            `[StreamManager] Failed to update recording ${recordingId}:`,
            e
          )
        );
    }

    await prisma.camera
      .update({
        where: { id: cameraId },
        data: { isStreaming: false, isRecording: false },
      })
      .catch((e) =>
        console.error(
          `[StreamManager] Failed to update camera ${cameraId}:`,
          e
        )
      );

    // Emit failure event
    appEvents.emit('camera-event', {
      type: 'alert',
      cameraId,
      organizationId: streamProc.organizationId,
      branchId: '',
      data: {
        action: 'stream_failed',
        reason,
        restartCount: streamProc.restartCount,
      },
    });

    this.streams.delete(cameraId);
  }

  // -----------------------------------------------------------------------
  // Process termination helpers
  // -----------------------------------------------------------------------

  private killProcess(streamProc: StreamProcess): Promise<void> {
    return new Promise((resolve) => {
      const { process: proc, cameraId } = streamProc;

      if (!proc || proc.killed) {
        resolve();
        return;
      }

      const forceKillTimer = setTimeout(() => {
        console.warn(
          `[StreamManager] Force killing ffmpeg for camera ${cameraId}`
        );
        try {
          proc.kill('SIGKILL');
        } catch {
          // already dead
        }
        resolve();
      }, 5_000);

      proc.once('exit', () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      // Send SIGINT first for graceful HLS segment finalization
      try {
        proc.kill('SIGINT');
      } catch {
        clearTimeout(forceKillTimer);
        resolve();
      }
    });
  }

  private waitForStop(cameraId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (!this.streams.has(cameraId) || Date.now() - start > timeoutMs) {
          resolve();
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  // -----------------------------------------------------------------------
  // Recording helpers
  // -----------------------------------------------------------------------

  private async finalizeRecording(streamProc: StreamProcess): Promise<void> {
    const { recordingId, recordDir } = streamProc;
    if (!recordingId) return;

    try {
      // Calculate total file size and duration from segment files
      const { totalSize, totalDuration } =
        await this.measureSegments(recordDir);

      await prisma.recording.update({
        where: { id: recordingId },
        data: {
          status: 'completed',
          endedAt: new Date(),
          fileSize: totalSize,
          duration: totalDuration,
        },
      });
    } catch (err) {
      console.error(
        `[StreamManager] Error finalizing recording ${recordingId}:`,
        err
      );
      await prisma.recording
        .update({
          where: { id: recordingId },
          data: { status: 'error', endedAt: new Date() },
        })
        .catch(() => {});
    }

    streamProc.recordingId = null;
  }

  /**
   * Walk the recording directory to sum up .ts segment sizes and estimate
   * total duration (each segment is ~60 seconds).
   */
  private async measureSegments(
    dir: string
  ): Promise<{ totalSize: bigint; totalDuration: number }> {
    let totalSize = BigInt(0);
    let segmentCount = 0;

    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.ts')) continue;
        try {
          const stat = await fs.stat(path.join(dir, entry));
          totalSize += BigInt(stat.size);
          segmentCount++;
        } catch {
          // individual file stat failure — skip
        }
      }
    } catch {
      // directory read failure — return zeros
    }

    // Each segment is nominally 60 seconds
    const totalDuration = segmentCount * 60;
    return { totalSize, totalDuration };
  }

  // -----------------------------------------------------------------------
  // Cleanup helpers
  // -----------------------------------------------------------------------

  /** Remove live HLS segments and playlist when streaming stops. */
  private async cleanupLiveSegments(liveDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(liveDir);
      const deletePromises = entries.map((entry) =>
        fs
          .unlink(path.join(liveDir, entry))
          .catch((err) =>
            console.warn(
              `[StreamManager] Failed to delete live segment ${entry}:`,
              err.message
            )
          )
      );
      await Promise.allSettled(deletePromises);
      // Try to remove the now-empty directory (ignore if not empty)
      await fs.rmdir(liveDir).catch(() => {});
    } catch (err) {
      console.warn(
        `[StreamManager] Failed to cleanup live segments in ${liveDir}:`,
        err
      );
    }
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private buildStreamInfo(streamProc: StreamProcess): StreamInfo {
    return {
      cameraId: streamProc.cameraId,
      pid: streamProc.pid,
      startedAt: streamProc.startedAt,
      restartCount: streamProc.restartCount,
      livePlaylistUrl: `/api/streams/${streamProc.cameraId}/live.m3u8`,
      recordDir: streamProc.recordDir,
      isStreaming: !streamProc.stopping,
    };
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatHour(date: Date): string {
    return String(date.getHours()).padStart(2, '0');
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

const globalForStreamManager = globalThis as unknown as {
  streamManager: StreamManager | undefined;
};

export const streamManager =
  globalForStreamManager.streamManager ?? StreamManager.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForStreamManager.streamManager = streamManager;

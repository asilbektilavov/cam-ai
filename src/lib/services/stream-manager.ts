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
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');

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

  /** Start live HLS streaming + archive recording for a camera. */
  async startStream(cameraId: string): Promise<StreamInfo> {
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

    // Prepare directories
    const liveDir = path.join(STREAMS_DIR, cameraId);
    const now = new Date();
    const dateDir = this.formatDate(now); // YYYY-MM-DD
    const hourDir = this.formatHour(now); // HH
    const recordDir = path.join(RECORDINGS_DIR, cameraId, dateDir, hourDir);

    await fs.mkdir(liveDir, { recursive: true });
    await fs.mkdir(recordDir, { recursive: true });

    // Create Recording entry in DB
    const recording = await prisma.recording.create({
      data: {
        cameraId: camera.id,
        organizationId: camera.organizationId,
        segmentDir: path.relative(DATA_DIR, recordDir),
        status: 'recording',
      },
    });

    // Build ffmpeg args
    const ffmpegArgs = this.buildFfmpegArgs(camera.streamUrl, liveDir, recordDir);

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
    };

    this.streams.set(cameraId, streamProc);

    // Attach lifecycle handlers
    this.attachProcessHandlers(streamProc, camera.streamUrl);

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
        '-stimeout', '5000000', // 5 seconds connection timeout (microseconds)
      );
    }

    if (isMjpeg) {
      inputArgs.push('-f', 'mjpeg');
    }

    inputArgs.push(
      '-i', streamUrl,
      // Reconnect options for network streams
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
    );

    // --- Encoding args (shared) ---
    const encodeArgs: string[] = [
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-g', '48',          // keyframe interval (2s at 24fps)
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-f', 'tee',
    ];

    // --- Output 1: Live HLS ---
    const livePlaylist = path.join(liveDir, 'live.m3u8');
    const liveSegmentPattern = path.join(liveDir, 'seg_%03d.ts');
    const liveOutput = [
      `[f=hls`,
      `hls_time=4`,
      `hls_list_size=10`,
      `hls_flags=delete_segments+append_list`,
      `hls_segment_filename=${liveSegmentPattern}]${livePlaylist}`,
    ].join(':');

    // --- Output 2: Archive segments ---
    const archiveSegmentPattern = path.join(recordDir, '%Y-%m-%d_%H-%M-%S.ts');
    const archivePlaylist = path.join(recordDir, 'index.m3u8');
    const archiveOutput = [
      `[f=segment`,
      `segment_time=60`,
      `segment_format=mpegts`,
      `strftime=1`,
      `segment_list=${archivePlaylist}`,
      `segment_list_type=m3u8`,
      `reset_timestamps=1]${archiveSegmentPattern}`,
    ].join(':');

    // Combine with tee muxer using pipe separator
    const teeOutput = `${liveOutput}|${archiveOutput}`;

    return [...inputArgs, ...encodeArgs, teeOutput];
  }

  // -----------------------------------------------------------------------
  // Process lifecycle
  // -----------------------------------------------------------------------

  private attachProcessHandlers(
    streamProc: StreamProcess,
    streamUrl: string
  ): void {
    const { process: proc, cameraId } = streamProc;

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
    streamUrl: string,
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

    // Retry with exponential backoff
    if (streamProc.restartCount >= MAX_RESTART_RETRIES) {
      console.error(
        `[StreamManager] Max retries (${MAX_RESTART_RETRIES}) exceeded for camera ${cameraId}`
      );
      await this.markStreamFailed(
        streamProc,
        `Max retries exceeded. Last: ${reason}`
      );
      return;
    }

    const delay =
      BASE_RESTART_DELAY_MS * Math.pow(2, streamProc.restartCount);
    streamProc.restartCount++;

    console.log(
      `[StreamManager] Restarting stream for camera ${cameraId} ` +
        `in ${delay}ms (attempt ${streamProc.restartCount}/${MAX_RESTART_RETRIES})`
    );

    streamProc.restartTimer = setTimeout(() => {
      void this.restartProcess(streamProc, streamUrl);
    }, delay);
  }

  private async restartProcess(
    streamProc: StreamProcess,
    streamUrl: string
  ): Promise<void> {
    const { cameraId, liveDir } = streamProc;

    // Check if we were stopped while waiting for restart
    if (streamProc.stopping || this.shuttingDown) return;

    // Rotate recording directory to current hour
    const now = new Date();
    const dateDir = this.formatDate(now);
    const hourDir = this.formatHour(now);
    const newRecordDir = path.join(RECORDINGS_DIR, cameraId, dateDir, hourDir);

    await fs.mkdir(newRecordDir, { recursive: true });

    // Finalize old recording
    await this.finalizeRecording(streamProc);

    // Create new recording entry
    const recording = await prisma.recording.create({
      data: {
        cameraId,
        organizationId: streamProc.organizationId,
        segmentDir: path.relative(DATA_DIR, newRecordDir),
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

    this.attachProcessHandlers(streamProc, streamUrl);

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

export const streamManager = StreamManager.getInstance();

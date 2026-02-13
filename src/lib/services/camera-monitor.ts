import { prisma } from '@/lib/prisma';
import { compareFrames, fetchSnapshot, getFrameTimestamp, startRtspGrabber, stopRtspGrabber } from './motion-detector';
import { saveFrame } from './frame-storage';
import { appEvents, CameraEvent } from './event-emitter';
import { analyzeFrame } from './ai-analyzer';
import { generateSessionSummary } from './session-summary';
import { smartFeaturesEngine } from './smart-features-engine';
import { go2rtcManager } from './go2rtc-manager';
import { disableCameraBuiltinAI } from './camera-ai-disabler';

interface MonitorState {
  cameraId: string;
  organizationId: string;
  branchId: string;
  streamUrl: string;
  /** Substream URL used for motion detection (lower resolution) */
  activeStreamUrl: string;
  cameraName: string;
  cameraLocation: string;
  motionThreshold: number;
  captureInterval: number;
  pollInterval: ReturnType<typeof setInterval> | null;
  captureTimer: ReturnType<typeof setInterval> | null;
  lastFrame: Buffer | null;
  activeSessionId: string | null;
  noMotionCount: number;
}

const NO_MOTION_TIMEOUT_POLLS = 150; // ~30s at 200ms effective poll
const POLL_INTERVAL_MS = 500; // 500ms — motion detection only (YOLO moved to detection-service)

/**
 * Derive a substream URL from the main stream URL.
 * Substreams are lower resolution (D1/CIF) — ideal for YOLO detection with less CPU/bandwidth.
 * Supports: Hikvision, Dahua, generic /stream1→/stream2.
 * Returns the original URL unchanged if no substream pattern is recognized.
 */
function deriveSubstreamUrl(streamUrl: string): string {
  // Hikvision: /Streaming/Channels/101 → /Streaming/Channels/102
  if (/\/Streaming\/Channels\/\d01/i.test(streamUrl)) {
    return streamUrl.replace(/(\/Streaming\/Channels\/\d)01/i, '$102');
  }
  // Dahua: subtype=0 → subtype=1
  if (/subtype=0/i.test(streamUrl)) {
    return streamUrl.replace(/subtype=0/i, 'subtype=1');
  }
  // Generic: /stream1 → /stream2
  if (/\/stream1$/i.test(streamUrl)) {
    return streamUrl.replace(/\/stream1$/i, '/stream2');
  }
  // No recognized pattern — use main stream
  return streamUrl;
}

class CameraMonitor {
  private monitors = new Map<string, MonitorState>();
  private static instance: CameraMonitor;
  private restorePromise: Promise<void> | null = null;

  static getInstance(): CameraMonitor {
    if (!CameraMonitor.instance) {
      CameraMonitor.instance = new CameraMonitor();
    }
    return CameraMonitor.instance;
  }

  /**
   * Auto-restore monitoring for cameras that were marked isMonitoring=true in DB
   * but not currently being monitored in-memory (e.g. after hot-reload / restart).
   */
  async restoreFromDb(): Promise<void> {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = this._doRestore();
    return this.restorePromise;
  }

  private async _doRestore(): Promise<void> {
    try {
      const cameras = await prisma.camera.findMany({
        where: { isMonitoring: true },
        select: { id: true, name: true },
      });

      // Filter out cameras already monitored in-memory
      const toRestore = cameras.filter(c => !this.monitors.has(c.id));
      if (toRestore.length === 0) return;

      console.log(`[Monitor] Auto-restoring ${toRestore.length} camera(s): ${toRestore.map(c => c.name).join(', ')}`);

      for (const cam of toRestore) {
        try {
          await this.startMonitoring(cam.id);
        } catch (err) {
          console.error(`[Monitor] Failed to restore camera ${cam.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[Monitor] Auto-restore failed:', err);
    }
  }

  isMonitoring(cameraId: string): boolean {
    return this.monitors.has(cameraId);
  }

  /**
   * Get the latest cached frame from the monitoring pipeline.
   * Returns null if monitoring is not active or no frame yet.
   */
  getLatestFrame(cameraId: string): Buffer | null {
    const state = this.monitors.get(cameraId);
    return state?.lastFrame ?? null;
  }

  async startMonitoring(cameraId: string): Promise<void> {
    if (this.monitors.has(cameraId)) return;

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) throw new Error('Camera not found');

    // For RTSP YOLO pipeline: prefer substream (lower resolution, less CPU/bandwidth)
    const activeStreamUrl = deriveSubstreamUrl(camera.streamUrl);

    const state: MonitorState = {
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId,
      streamUrl: camera.streamUrl,
      activeStreamUrl,
      cameraName: camera.name,
      cameraLocation: camera.location,
      motionThreshold: camera.motionThreshold,
      captureInterval: camera.captureInterval,
      pollInterval: null,
      captureTimer: null,
      lastFrame: null,
      activeSessionId: null,
      noMotionCount: 0,
    };

    this.monitors.set(cameraId, state);

    // Start persistent RTSP grabber for YOLO (substream = lower bandwidth)
    startRtspGrabber(state.activeStreamUrl);

    // Register main stream in go2rtc for browser playback (higher quality)
    void go2rtcManager.addStream(cameraId, camera.streamUrl);

    // Отключить встроенную AI-детекцию камеры (fallback для камер добавленных до этой фичи)
    void disableCameraBuiltinAI(camera.streamUrl);

    // Initialize smart features state for this camera
    smartFeaturesEngine.initCamera(cameraId);

    // Update DB
    await prisma.camera.update({
      where: { id: cameraId },
      data: { isMonitoring: true, status: 'online' },
    });

    // Start polling
    state.pollInterval = setInterval(() => {
      this.poll(cameraId).catch((err) => {
        console.error(`[Monitor ${cameraId}] Poll error:`, err.message);
      });
    }, POLL_INTERVAL_MS);

    console.log(`[Monitor] Started monitoring camera ${cameraId}`);
  }

  async stopMonitoring(cameraId: string): Promise<void> {
    const state = this.monitors.get(cameraId);
    if (!state) return;

    if (state.pollInterval) clearInterval(state.pollInterval);
    if (state.captureTimer) clearInterval(state.captureTimer);

    // End active session if any
    if (state.activeSessionId) {
      await this.endSession(state);
    }

    this.monitors.delete(cameraId);

    // Stop persistent RTSP grabber
    stopRtspGrabber(state.activeStreamUrl);

    // Remove stream from go2rtc
    void go2rtcManager.removeStream(cameraId);

    // Cleanup smart features state
    smartFeaturesEngine.cleanupCamera(cameraId);

    await prisma.camera.update({
      where: { id: cameraId },
      data: { isMonitoring: false },
    });

    console.log(`[Monitor] Stopped monitoring camera ${cameraId}`);
  }

  private async poll(cameraId: string): Promise<void> {
    const state = this.monitors.get(cameraId);
    if (!state) return;

    const t0 = Date.now();
    let currentFrame: Buffer;
    try {
      currentFrame = await fetchSnapshot(state.activeStreamUrl, cameraId);
    } catch {
      // Camera unreachable — don't stop monitoring, just skip
      return;
    }
    const tSnap = Date.now();

    // YOLO detection moved to autonomous detection-service.
    // CameraMonitor now only handles motion detection + Gemini AI sessions.

    if (!state.lastFrame) {
      state.lastFrame = currentFrame;
      return;
    }

    const diff = await compareFrames(state.lastFrame, currentFrame);
    state.lastFrame = currentFrame;
    const tCompare = Date.now();

    const motionDetected = diff > state.motionThreshold;

    if (motionDetected) {
      console.log(
        `[Monitor ${cameraId}] Motion diff=${diff.toFixed(1)}% | snap=${tSnap - t0}ms compare=${tCompare - tSnap}ms`
      );
      state.noMotionCount = 0;

      if (!state.activeSessionId) {
        // Start a new analysis session
        await this.startSession(state, currentFrame);
      }
    } else {
      if (state.activeSessionId) {
        state.noMotionCount++;
        if (state.noMotionCount >= NO_MOTION_TIMEOUT_POLLS) {
          await this.endSession(state);
        }
      }
    }
  }

  private async startSession(
    state: MonitorState,
    triggerFrame: Buffer
  ): Promise<void> {
    const session = await prisma.analysisSession.create({
      data: {
        cameraId: state.cameraId,
        triggerType: 'motion',
      },
    });

    state.activeSessionId = session.id;

    // Save the trigger frame
    const framePath = await saveFrame(
      state.organizationId,
      state.cameraId,
      triggerFrame
    );

    const triggerAnalysisFrame = await prisma.analysisFrame.create({
      data: {
        sessionId: session.id,
        framePath,
      },
    });

    // Trigger AI analysis (non-blocking)
    void analyzeFrame(
      triggerAnalysisFrame.id,
      framePath,
      state.cameraId,
      state.organizationId,
      state.branchId,
      session.id
    );

    // Emit event
    const event: CameraEvent = {
      type: 'session_started',
      cameraId: state.cameraId,
      organizationId: state.organizationId,
      branchId: state.branchId,
      data: { sessionId: session.id },
    };
    appEvents.emit('camera-event', event);

    // Create DB event
    await prisma.event.create({
      data: {
        cameraId: state.cameraId,
        organizationId: state.organizationId,
        branchId: state.branchId,
        type: 'motion_detected',
        severity: 'info',
        description: 'Обнаружено движение, начата сессия анализа',
        sessionId: session.id,
      },
    });

    // Start periodic frame capture
    state.captureTimer = setInterval(async () => {
      try {
        await this.captureFrame(state);
      } catch (err) {
        console.error(`[Monitor ${state.cameraId}] Capture error:`, err);
      }
    }, state.captureInterval * 1000);

    console.log(
      `[Monitor] Session started for camera ${state.cameraId}: ${session.id}`
    );
  }

  private async captureFrame(state: MonitorState): Promise<void> {
    if (!state.activeSessionId) return;

    const t0 = Date.now();
    const frame = await fetchSnapshot(state.activeStreamUrl, state.cameraId);
    console.log(`[Monitor ${state.cameraId}] captureFrame: snap=${Date.now() - t0}ms`);
    const framePath = await saveFrame(
      state.organizationId,
      state.cameraId,
      frame
    );

    const analysisFrame = await prisma.analysisFrame.create({
      data: {
        sessionId: state.activeSessionId,
        framePath,
      },
    });

    // Trigger AI analysis (non-blocking)
    void analyzeFrame(
      analysisFrame.id,
      framePath,
      state.cameraId,
      state.organizationId,
      state.branchId,
      state.activeSessionId
    );

    const event: CameraEvent = {
      type: 'frame_analyzed',
      cameraId: state.cameraId,
      organizationId: state.organizationId,
      branchId: state.branchId,
      data: {
        sessionId: state.activeSessionId,
        frameId: analysisFrame.id,
        framePath,
      },
    };
    appEvents.emit('camera-event', event);
  }

  private async endSession(state: MonitorState): Promise<void> {
    if (!state.activeSessionId) return;

    if (state.captureTimer) {
      clearInterval(state.captureTimer);
      state.captureTimer = null;
    }

    const endedSessionId = state.activeSessionId;

    await prisma.analysisSession.update({
      where: { id: endedSessionId },
      data: {
        endedAt: new Date(),
        status: 'completed',
      },
    });

    // Generate session summary (non-blocking)
    void generateSessionSummary(endedSessionId);

    const event: CameraEvent = {
      type: 'session_ended',
      cameraId: state.cameraId,
      organizationId: state.organizationId,
      branchId: state.branchId,
      data: { sessionId: state.activeSessionId },
    };
    appEvents.emit('camera-event', event);

    console.log(
      `[Monitor] Session ended for camera ${state.cameraId}: ${state.activeSessionId}`
    );

    state.activeSessionId = null;
    state.noMotionCount = 0;
  }
}

const globalForCameraMonitor = globalThis as unknown as {
  cameraMonitor: CameraMonitor | undefined;
};

// Invalidate stale singleton if it lacks new methods (e.g. after adding restoreFromDb)
if (globalForCameraMonitor.cameraMonitor && typeof globalForCameraMonitor.cameraMonitor.restoreFromDb !== 'function') {
  console.log('[Monitor] Replacing stale singleton (missing restoreFromDb)');
  globalForCameraMonitor.cameraMonitor = undefined;
}

export const cameraMonitor =
  globalForCameraMonitor.cameraMonitor ?? CameraMonitor.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForCameraMonitor.cameraMonitor = cameraMonitor;

// Auto-restore monitoring: check DB for cameras with isMonitoring=true
// but not tracked in-memory (happens after hot-reload or server restart).
// restorePromise prevents duplicate calls.
void cameraMonitor.restoreFromDb();

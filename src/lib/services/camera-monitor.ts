import { prisma } from '@/lib/prisma';
import { compareFrames, fetchSnapshot, startRtspGrabber, stopRtspGrabber } from './motion-detector';
import { saveFrame } from './frame-storage';
import { appEvents, CameraEvent } from './event-emitter';
import { analyzeFrame } from './ai-analyzer';
import { generateSessionSummary } from './session-summary';
import { smartFeaturesEngine } from './smart-features-engine';
import { yoloDetector } from './yolo-detector';
import { heatmapGenerator } from './heatmap-generator';
import { peopleCounter } from './people-counter';
import { go2rtcManager } from './go2rtc-manager';
import { disableCameraBuiltinAI } from './camera-ai-disabler';

interface MonitorState {
  cameraId: string;
  organizationId: string;
  branchId: string;
  streamUrl: string;
  /** Substream URL used for YOLO/preview (lower resolution) */
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
  yoloInProgress: boolean;
  // Counters for throttled secondary detections
  pollCount: number;
}

const NO_MOTION_TIMEOUT_POLLS = 150; // ~30s at 200ms effective poll
const POLL_INTERVAL_MS = 100; // 100ms = up to ~10fps YOLO detection

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

  static getInstance(): CameraMonitor {
    if (!CameraMonitor.instance) {
      CameraMonitor.instance = new CameraMonitor();
    }
    return CameraMonitor.instance;
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
      yoloInProgress: false,
      pollCount: 0,
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

    // Fire YOLO immediately after snapshot (before compareFrames) to minimize latency
    if (!state.yoloInProgress) {
      void this.emitLiveDetections(state, currentFrame);
    }

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

  /**
   * Lightweight YOLO detection on poll frame — emits SSE detections every 1.5s
   * for real-time bounding boxes. No DB writes, no Gemini, no frame saving.
   * Also runs fire/plates/behavior detection every 10th frame to reduce CPU load.
   */
  private async emitLiveDetections(state: MonitorState, frame: Buffer): Promise<void> {
    state.yoloInProgress = true;
    state.pollCount++;
    try {
      const t0 = Date.now();
      const detections = await yoloDetector.detect(frame);
      const elapsed = Date.now() - t0;

      const personDetections = detections.filter(d => d.type === 'person');
      const personCount = personDetections.length;

      // Feed people positions into heatmap (center of bbox)
      if (personCount > 0) {
        const positions = personDetections.map(d => ({
          x: d.bbox.x + d.bbox.w / 2,
          y: d.bbox.y + d.bbox.h / 2,
        }));
        heatmapGenerator.recordPositions(state.cameraId, positions);
      }

      // Feed people count into counter
      peopleCounter.recordCount(state.cameraId, personCount);

      // Every 10th frame: run secondary detections (fire, plates, behavior)
      const runSecondary = state.pollCount % 10 === 0;

      // Fire/smoke detection (non-blocking, throttled)
      if (runSecondary) {
        void this.runFireDetection(state, frame);
        void this.runPlateDetection(state, frame);
        void this.runBehaviorAnalysis(state, frame);
      }

      const event: CameraEvent = {
        type: 'frame_analyzed',
        cameraId: state.cameraId,
        organizationId: state.organizationId,
        branchId: state.branchId,
        data: {
          detections,
          peopleCount: personCount,
          sessionId: state.activeSessionId,
        },
      };
      appEvents.emit('camera-event', event);

      // Evaluate smart features with YOLO detections (abandoned object, fall, tamper)
      // Compute brightness only every 10th frame to reduce CPU load
      let avgBrightness: number | undefined;
      if (state.pollCount % 10 === 0) {
        try {
          const sharp = (await import('sharp')).default;
          const stats = await sharp(frame).stats();
          avgBrightness = stats.channels.reduce((sum, ch) => sum + ch.mean, 0) / stats.channels.length;
        } catch { /* ignore brightness calc errors */ }
      }

      // Use cached camera name/location (no DB query per frame)
      void smartFeaturesEngine.evaluate(
        state.cameraId,
        state.organizationId,
        state.branchId,
        state.cameraName,
        state.cameraLocation,
        { peopleCount: personCount, description: '' },
        detections,
        avgBrightness
      );

      if (detections.length > 0) {
        console.log(
          `[Monitor ${state.cameraId}] YOLO: ${detections.length} det in ${elapsed}ms (${detections.map(d => `${d.label} ${Math.round(d.confidence * 100)}%`).join(', ')})`
        );
      }
    } catch {
      // Silent fail — non-critical for bounding boxes
    } finally {
      state.yoloInProgress = false;
    }
  }

  /**
   * Fire/smoke detection via OpenCV HSV — emits SSE events and creates DB events.
   */
  private async runFireDetection(state: MonitorState, frame: Buffer): Promise<void> {
    try {
      const result = await yoloDetector.detectFire(frame);
      if (!result) return;

      if (result.fireDetected) {
        const event: CameraEvent = {
          type: 'fire_detected',
          cameraId: state.cameraId,
          organizationId: state.organizationId,
          branchId: state.branchId,
          data: {
            confidence: result.fireConfidence,
            regions: result.fireRegions,
          },
        };
        appEvents.emit('camera-event', event);

        // Delegate to smart features engine for alert + DB event
        void smartFeaturesEngine.handleFireSmoke(
          state.cameraId, state.organizationId, state.branchId,
          'fire', result.fireConfidence, result.fireRegions
        );
      }

      if (result.smokeDetected) {
        const event: CameraEvent = {
          type: 'smoke_detected',
          cameraId: state.cameraId,
          organizationId: state.organizationId,
          branchId: state.branchId,
          data: {
            confidence: result.smokeConfidence,
            regions: result.smokeRegions,
          },
        };
        appEvents.emit('camera-event', event);

        void smartFeaturesEngine.handleFireSmoke(
          state.cameraId, state.organizationId, state.branchId,
          'smoke', result.smokeConfidence, result.smokeRegions
        );
      }
    } catch {
      // Silent fail
    }
  }

  /**
   * License plate detection via YOLO + EasyOCR — emits SSE events.
   */
  private async runPlateDetection(state: MonitorState, frame: Buffer): Promise<void> {
    try {
      const result = await yoloDetector.detectPlates(frame);
      if (!result || result.plates.length === 0) return;

      for (const plate of result.plates) {
        const event: CameraEvent = {
          type: 'plate_detected',
          cameraId: state.cameraId,
          organizationId: state.organizationId,
          branchId: state.branchId,
          data: {
            plateText: plate.text,
            confidence: plate.confidence,
            bbox: plate.bbox,
          },
        };
        appEvents.emit('camera-event', event);
      }

      // Delegate to smart features engine
      void smartFeaturesEngine.handlePlates(
        state.cameraId, state.organizationId, state.branchId,
        result.plates
      );
    } catch {
      // Silent fail
    }
  }

  /**
   * Behavior analytics (running, fighting, falling) + speed + crowd density.
   */
  private async runBehaviorAnalysis(state: MonitorState, frame: Buffer): Promise<void> {
    try {
      const result = await yoloDetector.analyzeBehavior(frame, state.cameraId);
      if (!result) return;

      // Emit behavior alerts
      for (const b of result.behaviors) {
        const eventType = b.behavior === 'falling' ? 'fall_detected' as const : 'alert' as const;
        const event: CameraEvent = {
          type: eventType,
          cameraId: state.cameraId,
          organizationId: state.organizationId,
          branchId: state.branchId,
          data: {
            behavior: b.behavior,
            label: b.label,
            confidence: b.confidence,
            bbox: b.bbox,
          },
        };
        appEvents.emit('camera-event', event);
      }

      // Delegate to smart features engine for alerts
      void smartFeaturesEngine.handleBehavior(
        state.cameraId, state.organizationId, state.branchId,
        result.behaviors, result.speeds, result.crowdDensity
      );
    } catch {
      // Silent fail
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

export const cameraMonitor =
  globalForCameraMonitor.cameraMonitor ?? CameraMonitor.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForCameraMonitor.cameraMonitor = cameraMonitor;

import { prisma } from '@/lib/prisma';
import { compareFrames, fetchSnapshot } from './motion-detector';
import { saveFrame } from './frame-storage';
import { appEvents, CameraEvent } from './event-emitter';
import { analyzeFrame } from './ai-analyzer';
import { generateSessionSummary } from './session-summary';

interface MonitorState {
  cameraId: string;
  organizationId: string;
  streamUrl: string;
  motionThreshold: number;
  captureInterval: number;
  pollInterval: ReturnType<typeof setInterval> | null;
  captureTimer: ReturnType<typeof setInterval> | null;
  lastFrame: Buffer | null;
  activeSessionId: string | null;
  noMotionCount: number;
}

const NO_MOTION_TIMEOUT_POLLS = 20; // ~30s at 1.5s poll interval
const POLL_INTERVAL_MS = 1500;

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

  async startMonitoring(cameraId: string): Promise<void> {
    if (this.monitors.has(cameraId)) return;

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) throw new Error('Camera not found');

    const state: MonitorState = {
      cameraId,
      organizationId: camera.organizationId,
      streamUrl: camera.streamUrl,
      motionThreshold: camera.motionThreshold,
      captureInterval: camera.captureInterval,
      pollInterval: null,
      captureTimer: null,
      lastFrame: null,
      activeSessionId: null,
      noMotionCount: 0,
    };

    this.monitors.set(cameraId, state);

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

    await prisma.camera.update({
      where: { id: cameraId },
      data: { isMonitoring: false },
    });

    console.log(`[Monitor] Stopped monitoring camera ${cameraId}`);
  }

  private async poll(cameraId: string): Promise<void> {
    const state = this.monitors.get(cameraId);
    if (!state) return;

    let currentFrame: Buffer;
    try {
      currentFrame = await fetchSnapshot(state.streamUrl);
    } catch {
      // Camera unreachable — don't stop monitoring, just skip
      return;
    }

    if (!state.lastFrame) {
      state.lastFrame = currentFrame;
      return;
    }

    const diff = await compareFrames(state.lastFrame, currentFrame);
    state.lastFrame = currentFrame;

    const motionDetected = diff > state.motionThreshold;

    if (motionDetected) {
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
      session.id
    );

    // Emit event
    const event: CameraEvent = {
      type: 'session_started',
      cameraId: state.cameraId,
      organizationId: state.organizationId,
      data: { sessionId: session.id },
    };
    appEvents.emit('camera-event', event);

    // Create DB event
    await prisma.event.create({
      data: {
        cameraId: state.cameraId,
        organizationId: state.organizationId,
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

    const frame = await fetchSnapshot(state.streamUrl);
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
      state.activeSessionId
    );

    const event: CameraEvent = {
      type: 'frame_analyzed',
      cameraId: state.cameraId,
      organizationId: state.organizationId,
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

export const cameraMonitor = CameraMonitor.getInstance();

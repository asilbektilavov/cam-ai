import { prisma } from '@/lib/prisma';
import { appEvents, SmartAlert, CameraEvent } from './event-emitter';

interface FeatureConfig {
  featureType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  integrationId: string | null;
}

interface WorkstationState {
  emptyStartTime: Date | null;
  alertSent: boolean;
}

interface LoiteringState {
  detectedStartTime: Date | null;
  alertSent: boolean;
}

interface QueueState {
  lastAlertTime: number;
}

interface CameraState {
  workstation: WorkstationState;
  loitering: LoiteringState;
  queue: QueueState;
}

// Cooldown: don't spam alerts for the same feature on the same camera
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

class SmartFeaturesEngine {
  private static instance: SmartFeaturesEngine;
  private cameraStates = new Map<string, CameraState>();
  // Cache of active features per camera (refreshed periodically)
  private featureCache = new Map<string, { features: FeatureConfig[]; fetchedAt: number }>();
  private CACHE_TTL_MS = 30000; // 30 seconds

  static getInstance(): SmartFeaturesEngine {
    if (!SmartFeaturesEngine.instance) {
      SmartFeaturesEngine.instance = new SmartFeaturesEngine();
    }
    return SmartFeaturesEngine.instance;
  }

  initCamera(cameraId: string): void {
    this.cameraStates.set(cameraId, {
      workstation: { emptyStartTime: null, alertSent: false },
      loitering: { detectedStartTime: null, alertSent: false },
      queue: { lastAlertTime: 0 },
    });
  }

  cleanupCamera(cameraId: string): void {
    this.cameraStates.delete(cameraId);
    this.featureCache.delete(cameraId);
  }

  async getActiveFeatures(cameraId: string): Promise<FeatureConfig[]> {
    const cached = this.featureCache.get(cameraId);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached.features;
    }

    const features = await prisma.smartFeature.findMany({
      where: { cameraId, enabled: true },
    });

    const parsed: FeatureConfig[] = features.map((f) => ({
      featureType: f.featureType,
      enabled: f.enabled,
      config: JSON.parse(f.config) as Record<string, unknown>,
      integrationId: f.integrationId,
    }));

    this.featureCache.set(cameraId, { features: parsed, fetchedAt: Date.now() });
    return parsed;
  }

  async evaluate(
    cameraId: string,
    organizationId: string,
    cameraName: string,
    cameraLocation: string,
    analysis: {
      peopleCount: number;
      description: string;
      queueLength?: number;
      loiteringDetected?: boolean;
      loiteringDetails?: string;
      staffCount?: number;
    }
  ): Promise<void> {
    const features = await this.getActiveFeatures(cameraId);
    if (features.length === 0) return;

    let state = this.cameraStates.get(cameraId);
    if (!state) {
      this.initCamera(cameraId);
      state = this.cameraStates.get(cameraId)!;
    }

    for (const feature of features) {
      switch (feature.featureType) {
        case 'queue_monitor':
          this.evaluateQueue(feature, state, cameraId, organizationId, cameraName, cameraLocation, analysis);
          break;
        case 'workstation_monitor':
          this.evaluateWorkstation(feature, state, cameraId, organizationId, cameraName, cameraLocation, analysis);
          break;
        case 'loitering_detection':
          this.evaluateLoitering(feature, state, cameraId, organizationId, cameraName, cameraLocation, analysis);
          break;
      }
    }
  }

  private evaluateQueue(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    cameraName: string,
    cameraLocation: string,
    analysis: { queueLength?: number; peopleCount: number }
  ): void {
    const maxQueueLength = (feature.config.maxQueueLength as number) || 5;
    const queueLength = analysis.queueLength ?? analysis.peopleCount;

    if (queueLength > maxQueueLength) {
      const now = Date.now();
      if (now - state.queue.lastAlertTime < ALERT_COOLDOWN_MS) return;
      state.queue.lastAlertTime = now;

      const alert: SmartAlert = {
        featureType: 'queue_monitor',
        cameraId,
        cameraName,
        cameraLocation,
        organizationId,
        integrationId: feature.integrationId,
        severity: queueLength > maxQueueLength * 2 ? 'critical' : 'warning',
        message: `Очередь превышена: ${queueLength} чел. (порог: ${maxQueueLength})`,
        metadata: { queueLength, maxQueueLength },
      };

      appEvents.emit('smart-alert', alert);
      this.emitCameraEvent('smart_alert', cameraId, organizationId, { ...alert });
    }
  }

  private evaluateWorkstation(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    cameraName: string,
    cameraLocation: string,
    analysis: { staffCount?: number; peopleCount: number }
  ): void {
    const minPeople = (feature.config.minPeople as number) || 1;
    const maxAbsenceSeconds = (feature.config.maxAbsenceSeconds as number) || 120;
    const staffCount = analysis.staffCount ?? analysis.peopleCount;

    if (staffCount < minPeople) {
      if (!state.workstation.emptyStartTime) {
        state.workstation.emptyStartTime = new Date();
        state.workstation.alertSent = false;
      }

      const elapsed = (Date.now() - state.workstation.emptyStartTime.getTime()) / 1000;
      if (elapsed >= maxAbsenceSeconds && !state.workstation.alertSent) {
        state.workstation.alertSent = true;

        const minutes = Math.round(elapsed / 60);
        const alert: SmartAlert = {
          featureType: 'workstation_monitor',
          cameraId,
          cameraName,
          cameraLocation,
          organizationId,
          integrationId: feature.integrationId,
          severity: 'warning',
          message: `Рабочее место пустует уже ${minutes} мин. (требуется мин. ${minPeople} чел.)`,
          metadata: { staffCount, minPeople, absenceSeconds: elapsed },
        };

        appEvents.emit('smart-alert', alert);
        this.emitCameraEvent('smart_alert', cameraId, organizationId, { ...alert });
      }
    } else {
      // Staff present — reset timer
      state.workstation.emptyStartTime = null;
      state.workstation.alertSent = false;
    }
  }

  private evaluateLoitering(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    cameraName: string,
    cameraLocation: string,
    analysis: { loiteringDetected?: boolean; loiteringDetails?: string }
  ): void {
    const maxLoiterSeconds = (feature.config.maxLoiterSeconds as number) || 300;

    if (analysis.loiteringDetected) {
      if (!state.loitering.detectedStartTime) {
        state.loitering.detectedStartTime = new Date();
        state.loitering.alertSent = false;
      }

      const elapsed = (Date.now() - state.loitering.detectedStartTime.getTime()) / 1000;
      if (elapsed >= maxLoiterSeconds && !state.loitering.alertSent) {
        state.loitering.alertSent = true;

        const minutes = Math.round(elapsed / 60);
        const alert: SmartAlert = {
          featureType: 'loitering_detection',
          cameraId,
          cameraName,
          cameraLocation,
          organizationId,
          integrationId: feature.integrationId,
          severity: 'warning',
          message: `Обнаружено праздношатание: человек находится на одном месте более ${minutes} мин.${analysis.loiteringDetails ? ` (${analysis.loiteringDetails})` : ''}`,
          metadata: { loiterSeconds: elapsed, details: analysis.loiteringDetails },
        };

        appEvents.emit('smart-alert', alert);
        this.emitCameraEvent('smart_alert', cameraId, organizationId, { ...alert });
      }
    } else {
      // No loitering — reset
      state.loitering.detectedStartTime = null;
      state.loitering.alertSent = false;
    }
  }

  private emitCameraEvent(
    type: CameraEvent['type'],
    cameraId: string,
    organizationId: string,
    data: Record<string, unknown>
  ): void {
    const event: CameraEvent = { type, cameraId, organizationId, data };
    appEvents.emit('camera-event', event);
  }
}

export const smartFeaturesEngine = SmartFeaturesEngine.getInstance();

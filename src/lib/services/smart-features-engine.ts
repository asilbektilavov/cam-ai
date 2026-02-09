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

interface FireSmokeState {
  lastAlertTime: number;
}

interface PPEState {
  lastAlertTime: number;
}

interface AbandonedObjectState {
  /** Objects that have been stationary across frames: objectKey -> { firstSeen, bbox, alertSent } */
  trackedObjects: Map<string, { firstSeen: number; bbox: { x: number; y: number; w: number; h: number }; alertSent: boolean }>;
}

interface FallDetectionState {
  /** Previous person bounding boxes for height comparison */
  prevPersonBoxes: Array<{ x: number; y: number; w: number; h: number }>;
  lastAlertTime: number;
}

interface TamperState {
  /** Previous frame average brightness for comparison */
  prevBrightness: number | null;
  /** Count of consecutive tamper frames */
  tamperFrameCount: number;
  lastAlertTime: number;
}

interface LineCrossingState {
  /** Previous centroids: trackId -> { cx, cy } */
  prevCentroids: Map<number, { cx: number; cy: number }>;
  lastAlertTime: number;
}

interface LPRState {
  lastAlertTime: number;
  /** Recently seen plates to avoid duplicate alerts */
  recentPlates: Map<string, number>;
}

interface BehaviorState {
  lastAlertTime: number;
}

interface CrowdDensityState {
  lastAlertTime: number;
}

interface CameraState {
  workstation: WorkstationState;
  loitering: LoiteringState;
  queue: QueueState;
  fireSmoke: FireSmokeState;
  ppe: PPEState;
  abandonedObject: AbandonedObjectState;
  fallDetection: FallDetectionState;
  tamper: TamperState;
  lineCrossing: LineCrossingState;
  lpr: LPRState;
  behavior: BehaviorState;
  crowdDensity: CrowdDensityState;
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
      fireSmoke: { lastAlertTime: 0 },
      ppe: { lastAlertTime: 0 },
      abandonedObject: { trackedObjects: new Map() },
      fallDetection: { prevPersonBoxes: [], lastAlertTime: 0 },
      tamper: { prevBrightness: null, tamperFrameCount: 0, lastAlertTime: 0 },
      lineCrossing: { prevCentroids: new Map(), lastAlertTime: 0 },
      lpr: { lastAlertTime: 0, recentPlates: new Map() },
      behavior: { lastAlertTime: 0 },
      crowdDensity: { lastAlertTime: 0 },
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
    branchId: string,
    cameraName: string,
    cameraLocation: string,
    analysis: {
      peopleCount: number;
      description: string;
      queueLength?: number;
      loiteringDetected?: boolean;
      loiteringDetails?: string;
      staffCount?: number;
    },
    detections?: Array<{ type: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>,
    frameBrightness?: number
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
          this.evaluateQueue(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, analysis);
          break;
        case 'workstation_monitor':
          this.evaluateWorkstation(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, analysis);
          break;
        case 'loitering_detection':
          this.evaluateLoitering(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, analysis);
          break;
        case 'abandoned_object':
          if (detections) {
            this.evaluateAbandonedObject(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, detections);
          }
          break;
        case 'fall_detection':
          if (detections) {
            this.evaluateFallDetection(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, detections);
          }
          break;
        case 'tamper_detection':
          this.evaluateTamperDetection(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, frameBrightness, detections);
          break;
        case 'line_crossing':
          if (detections) {
            this.evaluateLineCrossing(feature, state, cameraId, organizationId, branchId, cameraName, cameraLocation, detections);
          }
          break;
        case 'fire_smoke_detection':
        case 'ppe_detection':
        case 'lpr_detection':
        case 'heatmap_tracking':
          // fire/smoke and lpr are handled by handleFireSmoke() and handlePlates()
          break;
      }
    }
  }

  private evaluateQueue(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    branchId: string,
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
        branchId,
        integrationId: feature.integrationId,
        severity: queueLength > maxQueueLength * 2 ? 'critical' : 'warning',
        message: `Очередь превышена: ${queueLength} чел. (порог: ${maxQueueLength})`,
        metadata: { queueLength, maxQueueLength },
      };

      appEvents.emit('smart-alert', alert);
      this.emitCameraEvent('smart_alert', cameraId, organizationId, branchId, { ...alert });
    }
  }

  private evaluateWorkstation(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    branchId: string,
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
          branchId,
          integrationId: feature.integrationId,
          severity: 'warning',
          message: `Рабочее место пустует уже ${minutes} мин. (требуется мин. ${minPeople} чел.)`,
          metadata: { staffCount, minPeople, absenceSeconds: elapsed },
        };

        appEvents.emit('smart-alert', alert);
        this.emitCameraEvent('smart_alert', cameraId, organizationId, branchId, { ...alert });
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
    branchId: string,
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
          branchId,
          integrationId: feature.integrationId,
          severity: 'warning',
          message: `Обнаружено праздношатание: человек находится на одном месте более ${minutes} мин.${analysis.loiteringDetails ? ` (${analysis.loiteringDetails})` : ''}`,
          metadata: { loiterSeconds: elapsed, details: analysis.loiteringDetails },
        };

        appEvents.emit('smart-alert', alert);
        this.emitCameraEvent('smart_alert', cameraId, organizationId, branchId, { ...alert });
      }
    } else {
      // No loitering — reset
      state.loitering.detectedStartTime = null;
      state.loitering.alertSent = false;
    }
  }

  // ── Abandoned Object Detection ────────────────────────────────────────
  // Tracks non-person objects that stay stationary across frames.
  // If an object persists in approximately the same location for > threshold seconds, alert.
  private evaluateAbandonedObject(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    branchId: string,
    cameraName: string,
    cameraLocation: string,
    detections: Array<{ type: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>
  ): void {
    const thresholdSeconds = (feature.config.thresholdSeconds as number) || 120;
    const tracked = state.abandonedObject.trackedObjects;

    // Get non-person, non-vehicle objects (potential abandoned items)
    const suspiciousObjects = detections.filter(
      (d) => !['person', 'car', 'truck', 'bus', 'bicycle', 'motorcycle'].includes(d.type) && d.confidence > 0.5
    );

    // Update tracking: match by proximity (IoU-like check)
    const matchedKeys = new Set<string>();

    for (const obj of suspiciousObjects) {
      const objKey = `${obj.type}_${Math.round(obj.bbox.x * 10)}_${Math.round(obj.bbox.y * 10)}`;
      let bestMatch: string | null = null;
      let bestDist = Infinity;

      for (const [key, tracked_obj] of tracked.entries()) {
        const dx = obj.bbox.x - tracked_obj.bbox.x;
        const dy = obj.bbox.y - tracked_obj.bbox.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1 && dist < bestDist) { // within 10% of frame dimension
          bestDist = dist;
          bestMatch = key;
        }
      }

      if (bestMatch) {
        matchedKeys.add(bestMatch);
        const entry = tracked.get(bestMatch)!;
        const elapsed = (Date.now() - entry.firstSeen) / 1000;

        if (elapsed >= thresholdSeconds && !entry.alertSent) {
          entry.alertSent = true;
          const alert: SmartAlert = {
            featureType: 'abandoned_object',
            cameraId,
            cameraName,
            cameraLocation,
            organizationId,
            branchId,
            integrationId: feature.integrationId,
            severity: 'warning',
            message: `Обнаружен оставленный предмет (${obj.label}) — находится без движения более ${Math.round(elapsed / 60)} мин.`,
            metadata: { objectType: obj.type, elapsedSeconds: elapsed, bbox: obj.bbox },
          };
          appEvents.emit('smart-alert', alert);
          this.emitCameraEvent('abandoned_object', cameraId, organizationId, branchId, { ...alert });
        }
      } else {
        // New object — start tracking
        tracked.set(objKey, { firstSeen: Date.now(), bbox: obj.bbox, alertSent: false });
        matchedKeys.add(objKey);
      }
    }

    // Remove objects that are no longer visible
    for (const key of tracked.keys()) {
      if (!matchedKeys.has(key)) {
        tracked.delete(key);
      }
    }
  }

  // ── Fall Detection ──────────────────────────────────────────────────────
  // Detects when a person's bounding box aspect ratio changes drastically
  // (standing → horizontal), indicating a potential fall.
  private evaluateFallDetection(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    branchId: string,
    cameraName: string,
    cameraLocation: string,
    detections: Array<{ type: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>
  ): void {
    const now = Date.now();
    if (now - state.fallDetection.lastAlertTime < ALERT_COOLDOWN_MS) {
      state.fallDetection.prevPersonBoxes = detections
        .filter((d) => d.type === 'person')
        .map((d) => d.bbox);
      return;
    }

    const currentPersons = detections.filter((d) => d.type === 'person');
    const prevBoxes = state.fallDetection.prevPersonBoxes;

    for (const person of currentPersons) {
      const { w, h } = person.bbox;
      const aspectRatio = w / Math.max(h, 0.001);

      // A person lying down has width > height (aspect ratio > 1.2)
      // while standing has aspect ratio < 0.8
      if (aspectRatio > 1.3) {
        // Check if this person was standing before (aspect < 0.8)
        for (const prev of prevBoxes) {
          const prevAspect = prev.w / Math.max(prev.h, 0.001);
          // Proximity check
          const dx = Math.abs(person.bbox.x - prev.x);
          const dy = Math.abs(person.bbox.y - prev.y);
          if (dx < 0.15 && dy < 0.15 && prevAspect < 0.9) {
            // Fall detected: was standing (tall), now horizontal (wide)
            state.fallDetection.lastAlertTime = now;
            const alert: SmartAlert = {
              featureType: 'fall_detection',
              cameraId,
              cameraName,
              cameraLocation,
              organizationId,
              branchId,
              integrationId: feature.integrationId,
              severity: 'critical',
              message: 'Обнаружено падение человека! Требуется немедленная проверка.',
              metadata: { currentBbox: person.bbox, previousBbox: prev, aspectRatio },
            };
            appEvents.emit('smart-alert', alert);
            this.emitCameraEvent('alert', cameraId, organizationId, branchId, { ...alert });
            break;
          }
        }
      }
    }

    // Save current boxes for next frame comparison
    state.fallDetection.prevPersonBoxes = currentPersons.map((d) => d.bbox);
  }

  // ── Tamper / Sabotage Detection ──────────────────────────────────────────
  // Detects camera tampering: sudden drastic brightness change, obscured lens,
  // or complete loss of detections when previously there were many.
  private evaluateTamperDetection(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    branchId: string,
    cameraName: string,
    cameraLocation: string,
    frameBrightness?: number,
    detections?: Array<{ type: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>
  ): void {
    const now = Date.now();
    if (now - state.tamper.lastAlertTime < ALERT_COOLDOWN_MS) return;

    let tamperDetected = false;
    let tamperReason = '';

    // Check 1: Drastic brightness change (covered camera = very dark, spray = very bright)
    if (frameBrightness !== undefined && state.tamper.prevBrightness !== null) {
      const brightnessDelta = Math.abs(frameBrightness - state.tamper.prevBrightness);
      if (brightnessDelta > 80) { // >80 point change out of 255
        tamperDetected = true;
        tamperReason = `Резкое изменение яркости кадра (${Math.round(brightnessDelta)} единиц)`;
      }
      // Very dark frame (camera covered)
      if (frameBrightness < 10) {
        state.tamper.tamperFrameCount++;
        if (state.tamper.tamperFrameCount >= 5) {
          tamperDetected = true;
          tamperReason = 'Камера закрыта или заблокирована (очень тёмный кадр)';
        }
      }
      // Very bright frame (camera pointed at light/spray)
      else if (frameBrightness > 245) {
        state.tamper.tamperFrameCount++;
        if (state.tamper.tamperFrameCount >= 5) {
          tamperDetected = true;
          tamperReason = 'Камера засвечена или направлена на источник света';
        }
      } else {
        state.tamper.tamperFrameCount = 0;
      }
    }

    if (frameBrightness !== undefined) {
      state.tamper.prevBrightness = frameBrightness;
    }

    if (tamperDetected) {
      state.tamper.lastAlertTime = now;
      const alert: SmartAlert = {
        featureType: 'tamper_detection',
        cameraId,
        cameraName,
        cameraLocation,
        organizationId,
        branchId,
        integrationId: feature.integrationId,
        severity: 'critical',
        message: `Обнаружен саботаж камеры: ${tamperReason}`,
        metadata: { reason: tamperReason, brightness: frameBrightness },
      };
      appEvents.emit('smart-alert', alert);
      this.emitCameraEvent('tamper_detected', cameraId, organizationId, branchId, { ...alert });
    }
  }

  // ── Line Crossing Detection ──────────────────────────────────────────
  // Uses centroid tracking to detect when persons cross a configured virtual line.
  private evaluateLineCrossing(
    feature: FeatureConfig,
    state: CameraState,
    cameraId: string,
    organizationId: string,
    branchId: string,
    cameraName: string,
    cameraLocation: string,
    detections: Array<{ type: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>
  ): void {
    const now = Date.now();
    if (now - state.lineCrossing.lastAlertTime < ALERT_COOLDOWN_MS) return;

    // Get configured line points from feature config
    const linePoints = feature.config.linePoints as Array<{ x: number; y: number }> | undefined;
    if (!linePoints || linePoints.length < 2) return;

    const personDetections = detections.filter(d => d.type === 'person');
    const currentCentroids = new Map<number, { cx: number; cy: number }>();

    for (let i = 0; i < personDetections.length; i++) {
      const d = personDetections[i];
      const cx = d.bbox.x + d.bbox.w / 2;
      const cy = d.bbox.y + d.bbox.h / 2;

      // Match to closest previous centroid
      let bestMatch = -1;
      let bestDist = 0.15;
      for (const [pidx, prev] of state.lineCrossing.prevCentroids.entries()) {
        const dist = Math.sqrt((cx - prev.cx) ** 2 + (cy - prev.cy) ** 2);
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = pidx;
        }
      }

      if (bestMatch >= 0) {
        const prev = state.lineCrossing.prevCentroids.get(bestMatch)!;
        // Check if line segment (prev -> current) crosses the configured line
        if (this.segmentsIntersect(
          prev.cx, prev.cy, cx, cy,
          linePoints[0].x, linePoints[0].y, linePoints[1].x, linePoints[1].y
        )) {
          state.lineCrossing.lastAlertTime = now;

          const alert: SmartAlert = {
            featureType: 'line_crossing',
            cameraId,
            cameraName,
            cameraLocation,
            organizationId,
            branchId,
            integrationId: feature.integrationId,
            severity: 'warning',
            message: 'Обнаружено пересечение виртуальной линии',
            metadata: {
              from: { x: prev.cx, y: prev.cy },
              to: { x: cx, y: cy },
              linePoints,
            },
          };
          appEvents.emit('smart-alert', alert);
          this.emitCameraEvent('line_crossing', cameraId, organizationId, branchId, { ...alert });

          // Create DB event
          void prisma.event.create({
            data: {
              cameraId,
              organizationId,
              branchId,
              type: 'line_crossing',
              severity: 'warning',
              description: `Пересечение виртуальной линии на камере ${cameraName}`,
            },
          });
        }
      }

      currentCentroids.set(i, { cx, cy });
    }

    state.lineCrossing.prevCentroids = currentCentroids;
  }

  /** Check if two line segments intersect (P1-P2 and P3-P4). */
  private segmentsIntersect(
    p1x: number, p1y: number, p2x: number, p2y: number,
    p3x: number, p3y: number, p4x: number, p4y: number
  ): boolean {
    const d1 = this.crossProduct(p3x, p3y, p4x, p4y, p1x, p1y);
    const d2 = this.crossProduct(p3x, p3y, p4x, p4y, p2x, p2y);
    const d3 = this.crossProduct(p1x, p1y, p2x, p2y, p3x, p3y);
    const d4 = this.crossProduct(p1x, p1y, p2x, p2y, p4x, p4y);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      return true;
    }
    return false;
  }

  private crossProduct(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  // ── Public handlers called by camera-monitor ──────────────────────

  /**
   * Handle fire/smoke detection results from Python service.
   */
  async handleFireSmoke(
    cameraId: string,
    organizationId: string,
    branchId: string,
    type: 'fire' | 'smoke',
    confidence: number,
    regions: Array<{ bbox: { x: number; y: number; w: number; h: number }; area: number }>
  ): Promise<void> {
    const features = await this.getActiveFeatures(cameraId);
    const feature = features.find(f => f.featureType === 'fire_smoke_detection');
    if (!feature) return;

    let state = this.cameraStates.get(cameraId);
    if (!state) { this.initCamera(cameraId); state = this.cameraStates.get(cameraId)!; }

    const now = Date.now();
    if (now - state.fireSmoke.lastAlertTime < ALERT_COOLDOWN_MS) return;
    state.fireSmoke.lastAlertTime = now;

    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { name: true, location: true },
    });
    if (!camera) return;

    const label = type === 'fire' ? 'огня' : 'дыма';
    const alert: SmartAlert = {
      featureType: 'fire_smoke_detection',
      cameraId,
      cameraName: camera.name,
      cameraLocation: camera.location,
      organizationId,
      branchId,
      integrationId: feature.integrationId,
      severity: 'critical',
      message: `Обнаружение ${label}! Уверенность: ${Math.round(confidence * 100)}%`,
      metadata: { type, confidence, regions },
    };
    appEvents.emit('smart-alert', alert);
    this.emitCameraEvent(type === 'fire' ? 'fire_detected' : 'smoke_detected', cameraId, organizationId, branchId, { ...alert });

    // Create DB event
    await prisma.event.create({
      data: {
        cameraId,
        organizationId,
        branchId,
        type: type === 'fire' ? 'fire_detected' : 'smoke_detected',
        severity: 'critical',
        description: `Обнаружение ${label} на камере ${camera.name} (${Math.round(confidence * 100)}%)`,
      },
    });
  }

  /**
   * Handle license plate detection results.
   */
  async handlePlates(
    cameraId: string,
    organizationId: string,
    branchId: string,
    plates: Array<{ text: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>
  ): Promise<void> {
    const features = await this.getActiveFeatures(cameraId);
    const feature = features.find(f => f.featureType === 'lpr_detection');
    if (!feature) return;

    let state = this.cameraStates.get(cameraId);
    if (!state) { this.initCamera(cameraId); state = this.cameraStates.get(cameraId)!; }

    const now = Date.now();

    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { name: true, location: true },
    });
    if (!camera) return;

    for (const plate of plates) {
      // Check if we already alerted for this plate recently (5min cooldown per plate)
      const lastSeen = state.lpr.recentPlates.get(plate.text);
      if (lastSeen && now - lastSeen < ALERT_COOLDOWN_MS) continue;
      state.lpr.recentPlates.set(plate.text, now);

      const alert: SmartAlert = {
        featureType: 'lpr_detection',
        cameraId,
        cameraName: camera.name,
        cameraLocation: camera.location,
        organizationId,
        branchId,
        integrationId: feature.integrationId,
        severity: 'info',
        message: `Распознан номер: ${plate.text} (${Math.round(plate.confidence * 100)}%)`,
        metadata: { plateText: plate.text, confidence: plate.confidence, bbox: plate.bbox },
      };
      appEvents.emit('smart-alert', alert);
      this.emitCameraEvent('plate_detected', cameraId, organizationId, branchId, { ...alert });

      // Create DB event
      await prisma.event.create({
        data: {
          cameraId,
          organizationId,
          branchId,
          type: 'plate_detected',
          severity: 'info',
          description: `Номер ${plate.text} обнаружен на камере ${camera.name}`,
        },
      });

      // Save plate detection to PlateDetection table
      try {
        const existingPlate = await prisma.licensePlate.findFirst({
          where: { number: plate.text, organizationId },
        });

        await prisma.plateDetection.create({
          data: {
            number: plate.text,
            confidence: plate.confidence,
            cameraId,
            licensePlateId: existingPlate?.id || null,
          },
        });
      } catch { /* ignore duplicate or DB errors */ }
    }

    // Cleanup old plates from cache (>10 min old)
    for (const [text, ts] of state.lpr.recentPlates.entries()) {
      if (now - ts > ALERT_COOLDOWN_MS * 2) {
        state.lpr.recentPlates.delete(text);
      }
    }
  }

  /**
   * Handle behavior analysis results (running, fighting, falling + speed + density).
   */
  async handleBehavior(
    cameraId: string,
    organizationId: string,
    branchId: string,
    behaviors: Array<{ behavior: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>,
    speeds: Array<{ personIndex: number; speedMps: number; speedKmh: number; bbox: { x: number; y: number; w: number; h: number } }>,
    crowdDensity: { personCount: number; density: number; level: string; label: string }
  ): Promise<void> {
    let state = this.cameraStates.get(cameraId);
    if (!state) { this.initCamera(cameraId); state = this.cameraStates.get(cameraId)!; }

    const now = Date.now();

    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { name: true, location: true },
    });
    if (!camera) return;

    // Handle behavior alerts
    if (behaviors.length > 0 && now - state.behavior.lastAlertTime >= ALERT_COOLDOWN_MS) {
      state.behavior.lastAlertTime = now;

      for (const b of behaviors) {
        const severity = b.behavior === 'fighting' ? 'critical' as const : 'warning' as const;
        const alert: SmartAlert = {
          featureType: 'behavior_analytics',
          cameraId,
          cameraName: camera.name,
          cameraLocation: camera.location,
          organizationId,
          branchId,
          integrationId: null,
          severity,
          message: `${b.label} обнаружен(о) на камере ${camera.name} (${Math.round(b.confidence * 100)}%)`,
          metadata: { behavior: b.behavior, confidence: b.confidence, bbox: b.bbox },
        };
        appEvents.emit('smart-alert', alert);

        await prisma.event.create({
          data: {
            cameraId,
            organizationId,
            branchId,
            type: b.behavior === 'falling' ? 'fall_detected' : 'alert',
            severity,
            description: alert.message,
          },
        });
      }
    }

    // Handle crowd density alerts (crowded/very_crowded)
    if ((crowdDensity.level === 'crowded' || crowdDensity.level === 'very_crowded') &&
        now - state.crowdDensity.lastAlertTime >= ALERT_COOLDOWN_MS) {
      state.crowdDensity.lastAlertTime = now;

      const alert: SmartAlert = {
        featureType: 'crowd_density',
        cameraId,
        cameraName: camera.name,
        cameraLocation: camera.location,
        organizationId,
        branchId,
        integrationId: null,
        severity: crowdDensity.level === 'very_crowded' ? 'critical' : 'warning',
        message: `${crowdDensity.label}: ${crowdDensity.personCount} чел. (плотность: ${crowdDensity.density} чел/м²)`,
        metadata: { ...crowdDensity },
      };
      appEvents.emit('smart-alert', alert);
      this.emitCameraEvent('alert', cameraId, organizationId, branchId, { ...alert });

      await prisma.event.create({
        data: {
          cameraId,
          organizationId,
          branchId,
          type: 'crowd',
          severity: crowdDensity.level === 'very_crowded' ? 'critical' : 'warning',
          description: alert.message,
        },
      });
    }
  }

  private emitCameraEvent(
    type: CameraEvent['type'],
    cameraId: string,
    organizationId: string,
    branchId: string,
    data: Record<string, unknown>
  ): void {
    const event: CameraEvent = { type, cameraId, organizationId, branchId, data };
    appEvents.emit('camera-event', event);
  }
}

export const smartFeaturesEngine = SmartFeaturesEngine.getInstance();

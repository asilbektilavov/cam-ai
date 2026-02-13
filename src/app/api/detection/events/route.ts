import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';
import { heatmapGenerator } from '@/lib/services/heatmap-generator';
import { peopleCounter } from '@/lib/services/people-counter';
import { smartFeaturesEngine } from '@/lib/services/smart-features-engine';
import { saveFrame } from '@/lib/services/frame-storage';

// Process-level cache for latest detections per camera.
// Survives Turbopack HMR (unlike module-level variables).
const CACHE_KEY = '__camai_detectionCache__';
const proc = process as unknown as Record<string, Map<string, { detections: unknown[]; ts: number }> | undefined>;
if (!proc[CACHE_KEY]) {
  proc[CACHE_KEY] = new Map();
}
const detectionCache = proc[CACHE_KEY]!;

// GET /api/detection/events?cameraId=xxx — browser polls for latest detection data
export async function GET(req: NextRequest) {
  const cameraId = req.nextUrl.searchParams.get('cameraId');
  if (!cameraId) {
    return NextResponse.json({ detections: [] });
  }

  const cached = detectionCache.get(cameraId);
  if (!cached || Date.now() - cached.ts > 5000) {
    return NextResponse.json({ detections: [] });
  }

  return NextResponse.json({ detections: cached.detections });
}

// POST /api/detection/events — called by detection-service with detection results
export async function POST(req: NextRequest) {
  try {
  const body = await req.json();
  const { cameraId, detections, personCount, capturedAt, plates, behaviors, snapshot } = body as {
    cameraId: string;
    detections: Array<{
      type: string;
      label: string;
      confidence: number;
      bbox: { x: number; y: number; w: number; h: number };
      classId: number;
      color: string;
    }>;
    personCount: number;
    capturedAt: number;
    plates?: Array<{ text: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>;
    behaviors?: Array<{ behavior: string; label: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }>;
    snapshot?: string; // base64 JPEG from detection-service
  };

  if (!cameraId || !Array.isArray(detections)) {
    return NextResponse.json({ error: 'cameraId and detections required' }, { status: 400 });
  }

  // Store in process-level cache for browser polling
  detectionCache.set(cameraId, { detections, ts: Date.now() });

  // Log every 10th POST to avoid spam
  const logKey = '__camai_detectionLogCounter__';
  const logProc = process as unknown as Record<string, number>;
  logProc[logKey] = (logProc[logKey] || 0) + 1;
  if (logProc[logKey] % 10 === 0) {
    console.log(`[DetectionEvents] POST #${logProc[logKey]}: camera=${cameraId}, detections=${detections.length}, personCount=${personCount}`);
  }

  // Look up camera for org/branch context + capacity threshold
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { organizationId: true, branchId: true, name: true, location: true, maxPeopleCapacity: true },
  });

  if (!camera) {
    return NextResponse.json({ ok: true });
  }

  const orgId = camera.organizationId;
  const branchId = camera.branchId || '';

  // Feed heatmap
  const personDetections = detections.filter(d => d.type === 'person');
  if (personDetections.length > 0) {
    const positions = personDetections.map(d => ({
      x: d.bbox.x + d.bbox.w / 2,
      y: d.bbox.y + d.bbox.h / 2,
    }));
    heatmapGenerator.recordPositions(cameraId, positions);
  }

  // Feed people counter
  peopleCounter.recordCount(cameraId, personCount);

  if (logProc[logKey] % 10 === 0) {
    console.log(`[DetectionEvents] peopleCounter.recordCount(${cameraId}, ${personCount}) — stored=${peopleCounter.getCurrentCount(cameraId)}, readings=${peopleCounter.getReadingsCount(cameraId)}`);
  }

  // Capacity alert: save frame when personCount exceeds maxPeopleCapacity
  if (camera.maxPeopleCapacity && personCount >= camera.maxPeopleCapacity && snapshot) {
    const cooldownKey = '__camai_capacityCooldown__';
    const cooldownProc = process as unknown as Record<string, Map<string, number> | undefined>;
    if (!cooldownProc[cooldownKey]) cooldownProc[cooldownKey] = new Map();
    const cooldownMap = cooldownProc[cooldownKey]!;
    const lastAlert = cooldownMap.get(cameraId) || 0;
    const COOLDOWN_MS = 60_000; // 1 minute between alerts per camera

    if (Date.now() - lastAlert > COOLDOWN_MS) {
      cooldownMap.set(cameraId, Date.now());

      // Save snapshot to disk
      const frameBuffer = Buffer.from(snapshot, 'base64');
      const framePath = await saveFrame(orgId, cameraId, frameBuffer);

      // Create AnalysisSession + AnalysisFrame for object-search
      const session = await prisma.analysisSession.create({
        data: {
          cameraId,
          triggerType: 'capacity_alert',
          status: 'completed',
          endedAt: new Date(),
        },
      });

      await prisma.analysisFrame.create({
        data: {
          sessionId: session.id,
          framePath,
          peopleCount: personCount,
          description: `Превышение лимита: ${personCount}/${camera.maxPeopleCapacity} человек`,
          objects: JSON.stringify(['person']),
          detections: JSON.stringify(detections.filter(d => d.type === 'person')),
        },
      });

      // Create Event for event log
      await prisma.event.create({
        data: {
          cameraId,
          organizationId: orgId,
          branchId: branchId || undefined,
          type: 'crowd',
          severity: 'warning',
          description: `Превышение лимита: обнаружено ${personCount} чел. (лимит ${camera.maxPeopleCapacity})`,
          sessionId: session.id,
          metadata: JSON.stringify({ personCount, maxCapacity: camera.maxPeopleCapacity }),
        },
      });

      // Emit SSE crowd event
      const crowdEvent: CameraEvent = {
        type: 'crowd',
        cameraId,
        organizationId: orgId,
        branchId,
        data: { personCount, maxCapacity: camera.maxPeopleCapacity },
      };
      appEvents.emit('camera-event', crowdEvent);

      console.log(`[DetectionEvents] CAPACITY ALERT: camera=${cameraId}, people=${personCount}/${camera.maxPeopleCapacity}, frame saved=${framePath}`);
    }
  }

  // Emit SSE event for real-time overlay
  const event: CameraEvent = {
    type: 'frame_analyzed',
    cameraId,
    organizationId: orgId,
    branchId,
    data: {
      detections,
      peopleCount: personCount,
      capturedAt,
    },
  };
  appEvents.emit('camera-event', event);

  // Evaluate smart features
  void smartFeaturesEngine.evaluate(
    cameraId, orgId, branchId,
    camera.name, camera.location,
    { peopleCount: personCount, description: '' },
    detections as never,
    undefined
  );

  // Handle fire/smoke events
  const fireDetections = detections.filter(d => d.type === 'fire');
  const smokeDetections = detections.filter(d => d.type === 'smoke');
  if (fireDetections.length > 0) {
    const fireEvent: CameraEvent = {
      type: 'fire_detected',
      cameraId, organizationId: orgId, branchId,
      data: { confidence: fireDetections[0].confidence, regions: fireDetections.map(d => ({ bbox: d.bbox })) },
    };
    appEvents.emit('camera-event', fireEvent);
    void smartFeaturesEngine.handleFireSmoke(
      cameraId, orgId, branchId, 'fire',
      fireDetections[0].confidence,
      fireDetections.map(d => ({ bbox: d.bbox, area: d.bbox.w * d.bbox.h }))
    );
  }
  if (smokeDetections.length > 0) {
    const smokeEvent: CameraEvent = {
      type: 'smoke_detected',
      cameraId, organizationId: orgId, branchId,
      data: { confidence: smokeDetections[0].confidence, regions: smokeDetections.map(d => ({ bbox: d.bbox })) },
    };
    appEvents.emit('camera-event', smokeEvent);
    void smartFeaturesEngine.handleFireSmoke(
      cameraId, orgId, branchId, 'smoke',
      smokeDetections[0].confidence,
      smokeDetections.map(d => ({ bbox: d.bbox, area: d.bbox.w * d.bbox.h }))
    );
  }

  // Handle plates
  if (plates && plates.length > 0) {
    for (const plate of plates) {
      const plateEvent: CameraEvent = {
        type: 'plate_detected',
        cameraId, organizationId: orgId, branchId,
        data: { plateText: plate.text, confidence: plate.confidence, bbox: plate.bbox },
      };
      appEvents.emit('camera-event', plateEvent);
    }
    void smartFeaturesEngine.handlePlates(cameraId, orgId, branchId, plates);
  }

  // Handle behaviors
  if (behaviors && behaviors.length > 0) {
    for (const b of behaviors) {
      const eventType = b.behavior === 'falling' ? 'fall_detected' as const : 'alert' as const;
      const behaviorEvent: CameraEvent = {
        type: eventType,
        cameraId, organizationId: orgId, branchId,
        data: { behavior: b.behavior, label: b.label, confidence: b.confidence, bbox: b.bbox },
      };
      appEvents.emit('camera-event', behaviorEvent);
    }
  }

  return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[DetectionEvents] POST error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}

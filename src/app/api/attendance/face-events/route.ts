import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';

// Process-level cache for latest face detections per camera.
// Survives Turbopack HMR (unlike module-level variables).
const CACHE_KEY = '__camai_faceCache__';
const proc = process as unknown as Record<string, Map<string, { detections: unknown[]; ts: number }> | undefined>;
if (!proc[CACHE_KEY]) {
  proc[CACHE_KEY] = new Map();
}
const faceCache = proc[CACHE_KEY]!;

// GET /api/attendance/face-events?cameraId=xxx — browser polls for latest face data
export async function GET(req: NextRequest) {
  const cameraId = req.nextUrl.searchParams.get('cameraId');
  if (!cameraId) {
    return NextResponse.json({ detections: [] });
  }

  const cached = faceCache.get(cameraId);
  if (!cached || Date.now() - cached.ts > 5000) {
    // No data or stale (>5s) — return empty
    return NextResponse.json({ detections: [] });
  }

  return NextResponse.json({ detections: cached.detections });
}

// POST /api/attendance/face-events — called by attendance-service with face detections
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cameraId, faces } = body as {
    cameraId: string;
    faces: Array<{
      bbox: { x: number; y: number; w: number; h: number };
      name: string | null;
      confidence: number;
    }>;
  };

  if (!cameraId || !Array.isArray(faces)) {
    return NextResponse.json({ error: 'cameraId and faces required' }, { status: 400 });
  }

  // Convert to Detection format
  const detections = faces.map((f) => ({
    type: 'face',
    label: f.name || 'Unknown',
    confidence: f.confidence,
    bbox: f.bbox,
    classId: -1,
    color: f.name ? '#22C55E' : '#EF4444', // green for recognized, red for unknown
  }));

  // Store in process-level cache for polling
  faceCache.set(cameraId, { detections, ts: Date.now() });

  // Also emit via SSE for backward compatibility
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { organizationId: true, branchId: true },
  });

  if (camera) {
    const event: CameraEvent = {
      type: 'face_detected',
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId || '',
      data: { detections, capturedAt: Date.now() },
    };
    appEvents.emit('camera-event', event);
  }

  return NextResponse.json({ ok: true });
}

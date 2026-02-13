import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';

// POST /api/attendance/face-events — called by attendance-service with face detections
// Pushes face detection events to SSE stream for browser overlay rendering
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

  // Look up camera for org/branch context
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { organizationId: true, branchId: true },
  });

  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  // Convert to Detection format and emit SSE event
  const detections = faces.map((f) => ({
    type: 'face',
    label: f.name || 'Unknown',
    confidence: f.confidence,
    bbox: f.bbox,
    classId: -1,
    color: f.name ? '#22C55E' : '#EF4444', // green for recognized, red for unknown
  }));

  const event: CameraEvent = {
    type: 'face_detected',
    cameraId,
    organizationId: camera.organizationId,
    branchId: camera.branchId || '',
    data: {
      detections,
      capturedAt: Date.now(),
    },
  };

  appEvents.emit('camera-event', event);

  return NextResponse.json({ ok: true });
}

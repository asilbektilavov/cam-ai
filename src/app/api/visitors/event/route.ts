import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from '@/lib/services/event-emitter';

// POST /api/visitors/event — called by attendance-service when an unknown
// (non-employee) face approaches the camera close enough to pass the
// distance threshold. Stores a Visitor row purely as a count event — no
// snapshot, no PII other than the face encoding required for in-frame
// dedup. Operators verify individual visits against the video archive.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    cameraId,
    faceDescriptor,
    faceWidthPx,
    confidence,
    timestamp,
  } = body as {
    cameraId?: string;
    faceDescriptor?: number[];
    faceWidthPx?: number;
    confidence?: number;
    timestamp?: string;
  };

  if (!cameraId || !Array.isArray(faceDescriptor)) {
    return NextResponse.json(
      { error: 'cameraId and faceDescriptor required' },
      { status: 400 }
    );
  }

  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      organizationId: true,
      branchId: true,
      name: true,
      location: true,
    },
  });
  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  const visitor = await prisma.visitor.create({
    data: {
      organizationId: camera.organizationId,
      cameraId,
      faceDescriptor: JSON.stringify(faceDescriptor),
      faceWidthPx: Math.round(faceWidthPx ?? 0),
      confidence: confidence ?? 0,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    },
  });

  // Emit event for analytics + automation
  await prisma.event.create({
    data: {
      cameraId,
      organizationId: camera.organizationId,
      branchId: camera.branchId || undefined,
      type: 'visitor_counted',
      severity: 'info',
      description: `Новый посетитель (камера ${camera.name})`,
      metadata: JSON.stringify({
        visitorId: visitor.id,
        faceWidthPx: visitor.faceWidthPx,
      }),
    },
  });

  const cameraEvent: CameraEvent = {
    type: 'visitor_counted',
    cameraId,
    organizationId: camera.organizationId,
    branchId: camera.branchId || '',
    data: {
      visitorId: visitor.id,
      faceWidthPx: visitor.faceWidthPx,
      confidence: visitor.confidence,
    },
  };
  appEvents.emit('camera-event', cameraEvent);

  return NextResponse.json({ success: true, visitorId: visitor.id });
}

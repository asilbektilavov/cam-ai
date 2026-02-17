import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/cameras/[id]/tripwire — get tripwire config
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const camera = await prisma.camera.findUnique({
    where: { id },
    select: { tripwireLine: true },
  });

  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  let tripwire = null;
  if (camera.tripwireLine) {
    try {
      tripwire = typeof camera.tripwireLine === 'string'
        ? JSON.parse(camera.tripwireLine)
        : camera.tripwireLine;
    } catch { /* ignore */ }
  }

  return NextResponse.json({ tripwireLine: tripwire });
}

// PATCH /api/cameras/[id]/tripwire — save tripwire config
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { tripwireLine } = body;

  // Validate
  if (tripwireLine !== null) {
    if (typeof tripwireLine !== 'object') {
      return NextResponse.json({ error: 'Invalid tripwireLine' }, { status: 400 });
    }
    const { x1, y1, x2, y2, enabled } = tripwireLine;
    if (enabled) {
      for (const [key, val] of Object.entries({ x1, y1, x2, y2 })) {
        if (typeof val !== 'number' || val < 0 || val > 1) {
          return NextResponse.json(
            { error: `${key} must be a number between 0 and 1` },
            { status: 400 }
          );
        }
      }
    }
  }

  await prisma.camera.update({
    where: { id },
    data: {
      tripwireLine: tripwireLine ? JSON.stringify(tripwireLine) : null,
    },
  });

  // Notify line-crossing-service if camera is monitoring
  const camera = await prisma.camera.findUnique({
    where: { id },
    select: { isMonitoring: true, streamUrl: true, purpose: true },
  });

  if (camera?.purpose === 'line_crossing' && camera.isMonitoring) {
    try {
      const serviceUrl = process.env.LINE_CROSSING_SERVICE_URL || 'http://localhost:8004';
      if (tripwireLine?.enabled) {
        const go2rtcStreamUrl = `rtsp://localhost:8554/${id}`;
        await fetch(`${serviceUrl}/cameras/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cameraId: id,
            streamUrl: go2rtcStreamUrl,
            tripwireLine,
            direction: 'entry',
          }),
        });
      } else {
        await fetch(`${serviceUrl}/cameras/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cameraId: id }),
        });
      }
    } catch {
      // Service might not be running
    }
  }

  return NextResponse.json({ ok: true });
}

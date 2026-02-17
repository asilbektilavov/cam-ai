import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/line-crossing/cameras — list active line_crossing cameras (for service auto-recovery)
export async function GET() {
  const cameras = await prisma.camera.findMany({
    where: {
      purpose: 'line_crossing',
      isMonitoring: true,
    },
    select: {
      id: true,
      name: true,
      streamUrl: true,
      tripwireLine: true,
    },
  });

  return NextResponse.json(
    cameras.map((c) => {
      let tripwire = null;
      if (c.tripwireLine) {
        try {
          tripwire = typeof c.tripwireLine === 'string'
            ? JSON.parse(c.tripwireLine)
            : c.tripwireLine;
        } catch { /* ignore */ }
      }
      return {
        id: c.id,
        name: c.name,
        streamUrl: `rtsp://localhost:8554/${c.id}`, // go2rtc proxy to avoid RTSP session limits
        tripwireLine: tripwire,
        direction: 'entry',
      };
    })
  );
}

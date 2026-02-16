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
        streamUrl: c.streamUrl,
        tripwireLine: tripwire,
        direction: 'entry', // line_crossing defaults to entry; can be configured per camera
      };
    })
  );
}

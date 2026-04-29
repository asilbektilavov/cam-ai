import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEffectiveStreamUrl } from '@/lib/services/go2rtc-manager';

export async function GET(req: Request) {
  // Internal endpoint for plate-service camera recovery
  const syncHeader = req.headers.get('x-plate-sync');
  if (!syncHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cameras = await prisma.camera.findMany({
    where: {
      purpose: 'lpr',
      isMonitoring: true,
    },
    select: {
      id: true,
      name: true,
      streamUrl: true,
      useGo2rtcForStream: true,
    },
  });

  return NextResponse.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      streamUrl: getEffectiveStreamUrl(c),
    }))
  );
}

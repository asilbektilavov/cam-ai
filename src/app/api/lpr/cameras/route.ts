import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    },
  });

  return NextResponse.json(cameras);
}

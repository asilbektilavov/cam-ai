import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/detection/cameras — list active detection cameras (for detection-service auto-recovery)
export async function GET() {
  const cameras = await prisma.camera.findMany({
    where: {
      purpose: 'detection',
      isMonitoring: true,
    },
    select: {
      id: true,
      name: true,
      streamUrl: true,
    },
  });

  return NextResponse.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      streamUrl: c.streamUrl,
    }))
  );
}

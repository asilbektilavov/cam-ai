import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const branchId = new URL(req.url).searchParams.get('branchId');

  const cameraWhere = {
    organizationId: orgId,
    ...(branchId && { branchId }),
  };
  const eventWhere = {
    organizationId: orgId,
    ...(branchId && { branchId }),
  };

  const [totalCameras, onlineCameras, totalEvents, criticalEvents, recentFrames] =
    await Promise.all([
      prisma.camera.count({ where: cameraWhere }),
      prisma.camera.count({ where: { ...cameraWhere, status: 'online' } }),
      prisma.event.count({ where: eventWhere }),
      prisma.event.count({ where: { ...eventWhere, severity: 'critical' } }),
      prisma.analysisFrame.findMany({
        where: {
          session: { camera: cameraWhere },
          peopleCount: { not: null },
        },
        select: { peopleCount: true },
        orderBy: { capturedAt: 'desc' },
        take: 100,
      }),
    ]);

  const peopleDetected = recentFrames.reduce(
    (sum, f) => sum + (f.peopleCount || 0),
    0
  );

  return NextResponse.json({
    totalCameras,
    onlineCameras,
    totalEvents,
    criticalEvents,
    peopleDetected,
    avgOccupancy: recentFrames.length
      ? Math.round(peopleDetected / recentFrames.length)
      : 0,
  });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;

  const [totalCameras, onlineCameras, totalEvents, criticalEvents, recentFrames] =
    await Promise.all([
      prisma.camera.count({ where: { organizationId: orgId } }),
      prisma.camera.count({ where: { organizationId: orgId, status: 'online' } }),
      prisma.event.count({ where: { organizationId: orgId } }),
      prisma.event.count({ where: { organizationId: orgId, severity: 'critical' } }),
      prisma.analysisFrame.findMany({
        where: {
          session: { camera: { organizationId: orgId } },
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

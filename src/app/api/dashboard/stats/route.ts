import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, parseRemoteBranchId } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const rawBranchId = new URL(req.url).searchParams.get('branchId');
  const { isRemote, localBranchId, remoteInstanceId } = parseRemoteBranchId(rawBranchId);

  // If filtering by a remote instance, only return remote data
  if (isRemote && remoteInstanceId) {
    const [remoteCameras, remoteOnline, remoteEvents, remoteCritical] = await Promise.all([
      prisma.remoteCamera.count({ where: { remoteInstanceId } }),
      prisma.remoteCamera.count({ where: { remoteInstanceId, status: 'online' } }),
      prisma.remoteEvent.count({ where: { remoteInstanceId } }),
      prisma.remoteEvent.count({ where: { remoteInstanceId, severity: 'critical' } }),
    ]);

    return NextResponse.json({
      totalCameras: remoteCameras,
      onlineCameras: remoteOnline,
      totalEvents: remoteEvents,
      criticalEvents: remoteCritical,
      peopleDetected: 0,
      avgOccupancy: 0,
    });
  }

  const cameraWhere = {
    organizationId: orgId,
    ...(localBranchId && { branchId: localBranchId }),
  };
  const eventWhere = {
    organizationId: orgId,
    ...(localBranchId && { branchId: localBranchId }),
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

  let finalTotalCameras = totalCameras;
  let finalOnlineCameras = onlineCameras;
  let finalTotalEvents = totalEvents;
  let finalCriticalEvents = criticalEvents;

  // On central instance without branch filter, merge remote data
  if (process.env.INSTANCE_ROLE === 'central' && !localBranchId) {
    const [remoteCameras, remoteOnline, remoteEvents, remoteCritical] = await Promise.all([
      prisma.remoteCamera.count(),
      prisma.remoteCamera.count({ where: { status: 'online' } }),
      prisma.remoteEvent.count(),
      prisma.remoteEvent.count({ where: { severity: 'critical' } }),
    ]);

    finalTotalCameras += remoteCameras;
    finalOnlineCameras += remoteOnline;
    finalTotalEvents += remoteEvents;
    finalCriticalEvents += remoteCritical;
  }

  return NextResponse.json({
    totalCameras: finalTotalCameras,
    onlineCameras: finalOnlineCameras,
    totalEvents: finalTotalEvents,
    criticalEvents: finalCriticalEvents,
    peopleDetected,
    avgOccupancy: recentFrames.length
      ? Math.round(peopleDetected / recentFrames.length)
      : 0,
  });
}

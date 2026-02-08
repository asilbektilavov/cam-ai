import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);
  const cameraId = searchParams.get('cameraId') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const type = searchParams.get('type') || '';
  const search = searchParams.get('search') || '';
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  // Build camera filter: only cameras belonging to this org
  const orgCameras = await prisma.camera.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const orgCameraIds = orgCameras.map((c) => c.id);

  const detections = await prisma.plateDetection.findMany({
    where: {
      cameraId: {
        in: cameraId ? [cameraId].filter((id) => orgCameraIds.includes(id)) : orgCameraIds,
      },
      ...(from && { timestamp: { gte: new Date(from) } }),
      ...(to && { timestamp: { ...(from ? { gte: new Date(from) } : {}), lte: new Date(to) } }),
      ...(search && { number: { contains: search, mode: 'insensitive' as const } }),
      ...(type && type !== 'all' && {
        licensePlate: { type },
      }),
    },
    include: {
      camera: { select: { id: true, name: true, location: true } },
      licensePlate: { select: { id: true, number: true, type: true, ownerName: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: Math.min(limit, 200),
  });

  return NextResponse.json(detections);
}

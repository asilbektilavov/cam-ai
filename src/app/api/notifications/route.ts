import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_events');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);

  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
  const status = searchParams.get('status'); // pending | sent | failed
  const featureType = searchParams.get('featureType');
  const branchId = searchParams.get('branchId');

  const where = {
    organizationId: orgId,
    ...(status && { status }),
    ...(featureType && { featureType }),
    ...(branchId && { cameraId: { in: (await prisma.camera.findMany({ where: { branchId }, select: { id: true } })).map(c => c.id) } }),
  };

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        integration: { select: { id: true, type: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return NextResponse.json({
    notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

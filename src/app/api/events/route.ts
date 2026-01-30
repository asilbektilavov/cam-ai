import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);

  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const cameraId = searchParams.get('cameraId');
  const type = searchParams.get('type');
  const severity = searchParams.get('severity');

  const where = {
    organizationId: orgId,
    ...(cameraId && { cameraId }),
    ...(type && { type }),
    ...(severity && { severity }),
  };

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: { camera: { select: { name: true, location: true } } },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count({ where }),
  ]);

  return NextResponse.json({
    events,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

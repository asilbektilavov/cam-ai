import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);

  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const cameraId = searchParams.get('cameraId');
  const status = searchParams.get('status');

  const where = {
    camera: { organizationId: orgId },
    ...(cameraId && { cameraId }),
    ...(status && { status }),
  };

  const [sessions, total] = await Promise.all([
    prisma.analysisSession.findMany({
      where,
      include: {
        camera: { select: { name: true, location: true } },
        _count: { select: { frames: true } },
      },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.analysisSession.count({ where }),
  ]);

  return NextResponse.json({
    sessions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { cameraId } = body;

  if (!cameraId) {
    return badRequest('cameraId is required');
  }

  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, organizationId: orgId },
  });
  if (!camera) {
    return badRequest('Camera not found');
  }

  const analysisSession = await prisma.analysisSession.create({
    data: {
      cameraId,
      triggerType: 'manual',
    },
    include: {
      camera: { select: { name: true, location: true } },
    },
  });

  return NextResponse.json(analysisSession, { status: 201 });
}

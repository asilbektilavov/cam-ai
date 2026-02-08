import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_lpr');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const type = searchParams.get('type') || '';

  const plates = await prisma.licensePlate.findMany({
    where: {
      organizationId: orgId,
      ...(search && {
        number: { contains: search, mode: 'insensitive' as const },
      }),
      ...(type && type !== 'all' && { type }),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { detections: true } },
    },
  });

  return NextResponse.json(plates);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_lpr');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { number, type, ownerName, notes } = body;

  if (!number) {
    return badRequest('Номер обязателен');
  }

  // Check for duplicate
  const existing = await prisma.licensePlate.findUnique({
    where: { organizationId_number: { organizationId: orgId, number: number.toUpperCase() } },
  });
  if (existing) {
    return badRequest('Такой номер уже есть в базе');
  }

  const plate = await prisma.licensePlate.create({
    data: {
      organizationId: orgId,
      number: number.toUpperCase(),
      type: type || 'neutral',
      ownerName: ownerName || null,
      notes: notes || null,
    },
  });

  return NextResponse.json(plate, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.licensePlate.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Номер не найден');

  const body = await req.json();
  const { number, type, ownerName, notes } = body;

  const plate = await prisma.licensePlate.update({
    where: { id },
    data: {
      ...(number !== undefined && { number: number.toUpperCase() }),
      ...(type !== undefined && { type }),
      ...(ownerName !== undefined && { ownerName }),
      ...(notes !== undefined && { notes }),
    },
  });

  return NextResponse.json(plate);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const deleted = await prisma.licensePlate.deleteMany({
    where: { id, organizationId: orgId },
  });
  if (deleted.count === 0) return notFound('Номер не найден');

  return NextResponse.json({ success: true });
}

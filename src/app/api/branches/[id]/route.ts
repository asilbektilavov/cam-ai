import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_dashboard');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const branch = await prisma.branch.findFirst({
    where: { id, organizationId: orgId },
    include: {
      _count: { select: { cameras: true, events: true } },
    },
  });

  if (!branch) return notFound('Филиал не найден');

  return NextResponse.json(branch);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_branches');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.branch.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Филиал не найден');

  const body = await req.json();
  const { name, address } = body;

  if (!name) return badRequest('Название обязательно');

  const branch = await prisma.branch.update({
    where: { id },
    data: { name, address: address ?? existing.address },
  });

  return NextResponse.json(branch);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_branches');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.branch.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Филиал не найден');

  // Don't allow deleting the last branch
  const count = await prisma.branch.count({
    where: { organizationId: orgId },
  });
  if (count <= 1) {
    return NextResponse.json(
      { error: 'Нельзя удалить последний филиал' },
      { status: 400 }
    );
  }

  await prisma.branch.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

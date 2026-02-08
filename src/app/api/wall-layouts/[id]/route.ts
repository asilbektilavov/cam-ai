import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Verify layout belongs to the org
  const existing = await prisma.wallLayout.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!existing) {
    return notFound('Раскладка не найдена');
  }

  const body = await req.json();
  const { name, grid, slots, isDefault } = body;

  // Validate grid if provided
  if (grid) {
    const validGrids = ['1x1', '2x2', '3x3', '4x4'];
    if (!validGrids.includes(grid)) {
      return badRequest('Недопустимый формат сетки');
    }
  }

  // Validate slots JSON if provided
  if (slots) {
    try {
      const parsed = JSON.parse(slots);
      if (!Array.isArray(parsed)) {
        return badRequest('Слоты должны быть массивом');
      }
    } catch {
      return badRequest('Некорректный формат слотов');
    }
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    await prisma.wallLayout.updateMany({
      where: { organizationId: orgId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.wallLayout.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(grid !== undefined && { grid }),
      ...(slots !== undefined && { slots }),
      ...(isDefault !== undefined && { isDefault }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Verify layout belongs to the org
  const existing = await prisma.wallLayout.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!existing) {
    return notFound('Раскладка не найдена');
  }

  await prisma.wallLayout.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

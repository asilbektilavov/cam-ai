import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  const layouts = await prisma.wallLayout.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });

  return NextResponse.json(layouts);
}

export async function POST(req: NextRequest) {
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

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { name, grid, slots } = body;

  if (!name || !name.trim()) {
    return badRequest('Название раскладки обязательно');
  }

  const validGrids = ['1x1', '2x2', '3x3', '4x4'];
  if (grid && !validGrids.includes(grid)) {
    return badRequest('Недопустимый формат сетки');
  }

  // Validate slots JSON
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

  const layout = await prisma.wallLayout.create({
    data: {
      organizationId: orgId,
      name: name.trim(),
      grid: grid || '2x2',
      slots: slots || '[]',
    },
  });

  return NextResponse.json(layout, { status: 201 });
}

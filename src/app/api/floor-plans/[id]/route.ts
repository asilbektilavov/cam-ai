import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import fs from 'fs/promises';
import path from 'path';

const FLOOR_PLANS_DIR = path.join(process.cwd(), 'data', 'floor-plans');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const floorPlan = await prisma.floorPlan.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!floorPlan) return notFound('План не найден');

  return NextResponse.json(floorPlan);
}

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

  const existing = await prisma.floorPlan.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('План не найден');

  const body = await req.json();
  const { name, cameras, branchId, width, height } = body;

  // Validate cameras JSON if provided
  if (cameras !== undefined) {
    if (!Array.isArray(cameras)) {
      return badRequest('cameras должен быть массивом');
    }
    for (const cam of cameras) {
      if (!cam.cameraId || typeof cam.x !== 'number' || typeof cam.y !== 'number') {
        return badRequest('Каждая камера должна содержать cameraId, x, y');
      }
      if (cam.x < 0 || cam.x > 1 || cam.y < 0 || cam.y > 1) {
        return badRequest('Координаты x и y должны быть от 0 до 1');
      }
    }
  }

  const floorPlan = await prisma.floorPlan.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(cameras !== undefined && { cameras: JSON.stringify(cameras) }),
      ...(branchId !== undefined && { branchId: branchId || null }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    },
  });

  return NextResponse.json(floorPlan);
}

export async function DELETE(
  _req: NextRequest,
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

  const existing = await prisma.floorPlan.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('План не найден');

  // Delete the image file
  try {
    const filePath = path.join(FLOOR_PLANS_DIR, existing.imagePath);
    await fs.unlink(filePath);
  } catch {
    // File may not exist, ignore
  }

  await prisma.floorPlan.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

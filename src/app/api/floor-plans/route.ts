import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const FLOOR_PLANS_DIR = path.join(process.cwd(), 'data', 'floor-plans');

async function ensureDir(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

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
  const branchId = new URL(req.url).searchParams.get('branchId');

  const floorPlans = await prisma.floorPlan.findMany({
    where: {
      organizationId: orgId,
      ...(branchId && { branchId }),
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(floorPlans);
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest('Ожидается multipart/form-data');
  }

  const name = formData.get('name') as string | null;
  const branchId = formData.get('branchId') as string | null;
  const file = formData.get('image') as File | null;
  const widthStr = formData.get('width') as string | null;
  const heightStr = formData.get('height') as string | null;

  if (!name || !file) {
    return badRequest('Название и файл изображения обязательны');
  }

  // Validate file type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return badRequest('Допустимые форматы: PNG, JPG, SVG, WebP');
  }

  // Validate file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    return badRequest('Максимальный размер файла: 10 МБ');
  }

  // Verify branch belongs to org if provided
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: orgId },
    });
    if (!branch) return badRequest('Недопустимый филиал');
  }

  // Save file to disk
  await ensureDir(FLOOR_PLANS_DIR);

  const ext = file.name.split('.').pop() || 'png';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(FLOOR_PLANS_DIR, filename);

  const arrayBuffer = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));

  const width = widthStr ? parseInt(widthStr, 10) : 1000;
  const height = heightStr ? parseInt(heightStr, 10) : 700;

  const floorPlan = await prisma.floorPlan.create({
    data: {
      name,
      imagePath: filename,
      organizationId: orgId,
      branchId: branchId || null,
      cameras: '[]',
      width: isNaN(width) ? 1000 : width,
      height: isNaN(height) ? 700 : height,
    },
  });

  return NextResponse.json(floorPlan, { status: 201 });
}

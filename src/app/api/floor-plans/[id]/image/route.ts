import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import fs from 'fs/promises';
import path from 'path';

const FLOOR_PLANS_DIR = path.join(process.cwd(), 'data', 'floor-plans');

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

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

  const filePath = path.join(FLOOR_PLANS_DIR, floorPlan.imagePath);

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return notFound('Файл изображения не найден');
  }

  const ext = floorPlan.imagePath.split('.').pop()?.toLowerCase() || 'png';
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

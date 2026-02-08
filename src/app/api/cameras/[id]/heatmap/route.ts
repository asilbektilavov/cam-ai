import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { heatmapGenerator } from '@/lib/services/heatmap-generator';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_analytics');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to the user's organization
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, location: true },
  });

  if (!camera) return notFound('Camera not found');

  const grid = heatmapGenerator.getHeatmapData(id);
  const rawData = heatmapGenerator.getRawData(id);

  return NextResponse.json({
    cameraId: id,
    cameraName: camera.name,
    grid,
    gridWidth: 20,
    gridHeight: 15,
    hasData: heatmapGenerator.hasData(id),
    totalRecordings: rawData?.totalRecordings ?? 0,
    startedAt: rawData?.startedAt ?? null,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_analytics');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });

  if (!camera) return notFound('Camera not found');

  heatmapGenerator.resetHeatmap(id);

  return NextResponse.json({ success: true });
}

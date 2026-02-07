import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

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

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!camera) return notFound('Camera not found');

  const features = await prisma.smartFeature.findMany({
    where: { cameraId: id },
    include: {
      integration: { select: { id: true, type: true, name: true, enabled: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const parsed = features.map((f) => ({
    id: f.id,
    featureType: f.featureType,
    enabled: f.enabled,
    config: JSON.parse(f.config),
    integrationId: f.integrationId,
    integration: f.integration,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));

  return NextResponse.json(parsed);
}

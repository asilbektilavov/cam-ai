import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

const VALID_TYPES = ['queue_monitor', 'loitering_detection', 'workstation_monitor', 'person_search'];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; featureType: string }> }
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

  const { id, featureType } = await params;
  const orgId = session.user.organizationId;

  if (!VALID_TYPES.includes(featureType)) {
    return badRequest(`Invalid feature type: ${featureType}`);
  }

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!camera) return notFound('Camera not found');

  const body = await req.json();
  const { enabled, config, integrationId } = body;

  // Verify integration belongs to org if provided
  if (integrationId) {
    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, organizationId: orgId },
    });
    if (!integration) return badRequest('Integration not found');
  }

  const feature = await prisma.smartFeature.upsert({
    where: {
      cameraId_featureType: { cameraId: id, featureType },
    },
    create: {
      cameraId: id,
      featureType,
      enabled: enabled ?? false,
      config: JSON.stringify(config || {}),
      integrationId: integrationId || null,
    },
    update: {
      enabled: enabled ?? false,
      config: JSON.stringify(config || {}),
      integrationId: integrationId || null,
    },
  });

  return NextResponse.json({
    id: feature.id,
    featureType: feature.featureType,
    enabled: feature.enabled,
    config: JSON.parse(feature.config),
    integrationId: feature.integrationId,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; featureType: string }> }
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

  const { id, featureType } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!camera) return notFound('Camera not found');

  await prisma.smartFeature.deleteMany({
    where: { cameraId: id, featureType },
  });

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

const VALID_ZONE_TYPES = [
  'line_crossing',
  'queue_zone',
  'restricted_area',
  'counting_zone',
];

const VALID_DIRECTIONS = ['in', 'out', 'both'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; zoneId: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id, zoneId } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!camera) return notFound('Camera not found');

  // Verify zone belongs to camera
  const existingZone = await prisma.detectionZone.findFirst({
    where: { id: zoneId, cameraId: id },
  });
  if (!existingZone) return notFound('Detection zone not found');

  const body = await req.json();
  const { name, type, points, direction, config, enabled } = body;

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return badRequest('Zone name cannot be empty');
    }
    updateData.name = name.trim();
  }

  if (type !== undefined) {
    if (!VALID_ZONE_TYPES.includes(type)) {
      return badRequest(
        `Invalid zone type. Must be one of: ${VALID_ZONE_TYPES.join(', ')}`
      );
    }
    updateData.type = type;
  }

  if (points !== undefined) {
    if (!Array.isArray(points) || points.length < 2) {
      return badRequest('At least 2 points are required');
    }

    for (const point of points) {
      if (
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1
      ) {
        return badRequest(
          'Each point must have x and y as numbers between 0 and 1'
        );
      }
    }

    const effectiveType = type || existingZone.type;
    if (effectiveType === 'line_crossing' && points.length !== 2) {
      return badRequest('Line crossing must have exactly 2 points');
    }

    updateData.points = JSON.stringify(points);
  }

  if (direction !== undefined) {
    if (direction !== null && !VALID_DIRECTIONS.includes(direction)) {
      return badRequest(
        `Invalid direction. Must be one of: ${VALID_DIRECTIONS.join(', ')}`
      );
    }
    updateData.direction = direction;
  }

  if (config !== undefined) {
    updateData.config = JSON.stringify(config);
  }

  if (enabled !== undefined) {
    updateData.enabled = Boolean(enabled);
  }

  if (Object.keys(updateData).length === 0) {
    return badRequest('No fields to update');
  }

  const zone = await prisma.detectionZone.update({
    where: { id: zoneId },
    data: updateData,
  });

  return NextResponse.json({
    id: zone.id,
    cameraId: zone.cameraId,
    name: zone.name,
    type: zone.type,
    points: JSON.parse(zone.points),
    direction: zone.direction,
    config: JSON.parse(zone.config),
    enabled: zone.enabled,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; zoneId: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id, zoneId } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!camera) return notFound('Camera not found');

  // Verify zone belongs to camera
  const existingZone = await prisma.detectionZone.findFirst({
    where: { id: zoneId, cameraId: id },
  });
  if (!existingZone) return notFound('Detection zone not found');

  await prisma.detectionZone.delete({
    where: { id: zoneId },
  });

  return NextResponse.json({ success: true });
}

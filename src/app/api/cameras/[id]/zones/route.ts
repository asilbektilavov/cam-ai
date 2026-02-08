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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: unknown) {
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
    select: { id: true },
  });
  if (!camera) return notFound('Camera not found');

  const zones = await prisma.detectionZone.findMany({
    where: { cameraId: id },
    orderBy: { createdAt: 'asc' },
  });

  const parsed = zones.map((z) => ({
    id: z.id,
    cameraId: z.cameraId,
    name: z.name,
    type: z.type,
    points: JSON.parse(z.points),
    direction: z.direction,
    config: JSON.parse(z.config),
    enabled: z.enabled,
    createdAt: z.createdAt,
    updatedAt: z.updatedAt,
  }));

  return NextResponse.json(parsed);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to org
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!camera) return notFound('Camera not found');

  const body = await req.json();
  const { name, type, points, direction, config } = body;

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return badRequest('Zone name is required');
  }

  // Validate type
  if (!VALID_ZONE_TYPES.includes(type)) {
    return badRequest(
      `Invalid zone type. Must be one of: ${VALID_ZONE_TYPES.join(', ')}`
    );
  }

  // Validate points
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

  // Validate direction for line_crossing
  if (type === 'line_crossing') {
    if (direction && !VALID_DIRECTIONS.includes(direction)) {
      return badRequest(
        `Invalid direction. Must be one of: ${VALID_DIRECTIONS.join(', ')}`
      );
    }
    if (points.length !== 2) {
      return badRequest('Line crossing must have exactly 2 points');
    }
  }

  const zone = await prisma.detectionZone.create({
    data: {
      cameraId: id,
      name: name.trim(),
      type,
      points: JSON.stringify(points),
      direction: type === 'line_crossing' ? direction || 'both' : null,
      config: JSON.stringify(config || {}),
      enabled: true,
    },
  });

  return NextResponse.json(
    {
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
    },
    { status: 201 }
  );
}

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

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    include: {
      _count: { select: { sessions: true, events: true } },
    },
  });

  if (!camera) return notFound('Camera not found');

  return NextResponse.json(camera);
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

  const existing = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Camera not found');

  const body = await req.json();
  const {
    name, location, streamUrl, status, venueType, resolution, fps,
    motionThreshold, captureInterval, isMonitoring,
    onvifHost, onvifPort, onvifUser, onvifPass, hasPtz, retentionDays,
  } = body;

  const camera = await prisma.camera.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(location !== undefined && { location }),
      ...(streamUrl !== undefined && { streamUrl }),
      ...(status !== undefined && { status }),
      ...(venueType !== undefined && { venueType }),
      ...(resolution !== undefined && { resolution }),
      ...(fps !== undefined && { fps }),
      ...(motionThreshold !== undefined && { motionThreshold }),
      ...(captureInterval !== undefined && { captureInterval }),
      ...(isMonitoring !== undefined && { isMonitoring }),
      ...(onvifHost !== undefined && { onvifHost }),
      ...(onvifPort !== undefined && { onvifPort }),
      ...(onvifUser !== undefined && { onvifUser }),
      ...(onvifPass !== undefined && { onvifPass }),
      ...(hasPtz !== undefined && { hasPtz }),
      ...(retentionDays !== undefined && { retentionDays }),
    },
  });

  return NextResponse.json(camera);
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

  const deleted = await prisma.camera.deleteMany({
    where: { id, organizationId: orgId },
  });
  if (deleted.count === 0) return notFound('Camera not found');

  return NextResponse.json({ success: true });
}

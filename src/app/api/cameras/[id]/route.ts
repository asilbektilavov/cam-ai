import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Camera not found');

  const body = await req.json();
  const { name, location, streamUrl, status, venueType, resolution, fps, motionThreshold, captureInterval, isMonitoring } = body;

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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const deleted = await prisma.camera.deleteMany({
    where: { id, organizationId: orgId },
  });
  if (deleted.count === 0) return notFound('Camera not found');

  return NextResponse.json({ success: true });
}

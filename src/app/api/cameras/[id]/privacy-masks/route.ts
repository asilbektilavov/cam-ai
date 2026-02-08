import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(
  req: NextRequest,
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
    select: { privacyMasks: true },
  });

  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  const masks = camera.privacyMasks ? JSON.parse(camera.privacyMasks) : [];
  return NextResponse.json({ masks });
}

export async function PUT(
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
  const body = await req.json();

  if (!body.masks || !Array.isArray(body.masks)) {
    return badRequest('masks array is required');
  }

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!camera) {
    return NextResponse.json({ error: 'Camera not found' }, { status: 404 });
  }

  await prisma.camera.update({
    where: { id },
    data: { privacyMasks: JSON.stringify(body.masks) },
  });

  return NextResponse.json({ success: true, masks: body.masks });
}

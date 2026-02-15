import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { disableCameraBuiltinAI } from '@/lib/services/camera-ai-disabler';

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

  const cameras = await prisma.camera.findMany({
    where: {
      organizationId: orgId,
      ...(branchId && { branchId }),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(cameras);
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
  const body = await req.json();

  const {
    name, location, streamUrl, branchId, venueType, resolution, fps,
    motionThreshold, captureInterval, purpose,
    onvifHost, onvifPort, onvifUser, onvifPass, hasPtz,
  } = body;

  if (!name || !streamUrl || !branchId) {
    return badRequest('Name, streamUrl, and branchId are required');
  }

  // Verify branch belongs to org
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: orgId },
  });
  if (!branch) return badRequest('Invalid branchId');

  // Auto-set venueType based on purpose
  const effectiveVenueType = venueType || (purpose === 'lpr' ? 'parking' : 'retail');

  const camera = await prisma.camera.create({
    data: {
      name,
      location: location || name,
      streamUrl,
      branchId,
      venueType: effectiveVenueType,
      purpose: purpose || 'detection',
      resolution: resolution || '1920x1080',
      fps: fps || 30,
      motionThreshold: motionThreshold || 5.0,
      captureInterval: captureInterval || 5,
      organizationId: orgId,
      ...(onvifHost && { onvifHost }),
      ...(onvifPort && { onvifPort: Number(onvifPort) }),
      ...(onvifUser && { onvifUser }),
      ...(onvifPass && { onvifPass }),
      ...(hasPtz !== undefined && { hasPtz: Boolean(hasPtz) }),
    },
  });

  // Отключить встроенную AI-детекцию камеры (best-effort, не блокирует ответ)
  void disableCameraBuiltinAI(streamUrl);

  return NextResponse.json(camera, { status: 201 });
}

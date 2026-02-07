import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkTrialOrSubscription } from '@/lib/trial-guard';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

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

  const orgId = session.user.organizationId;
  const body = await req.json();

  const { name, location, streamUrl, branchId, venueType, resolution, fps, motionThreshold, captureInterval } = body;

  if (!name || !location || !streamUrl || !branchId) {
    return badRequest('Name, location, streamUrl, and branchId are required');
  }

  // Check trial/subscription
  const trialStatus = await checkTrialOrSubscription(orgId);
  if (!trialStatus.allowed) {
    return NextResponse.json(
      { error: 'Пробный период истёк. Оформите подписку для продолжения.' },
      { status: 403 }
    );
  }

  // Verify branch belongs to org
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: orgId },
  });
  if (!branch) return badRequest('Invalid branchId');

  // Check plan camera limit
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { plan: true, _count: { select: { cameras: true } } },
  });
  const maxCameras = org?.plan?.maxCameras ?? 2;
  if (org && org._count.cameras >= maxCameras) {
    return NextResponse.json(
      { error: `Лимит тарифа: максимум ${maxCameras} камер. Обновите тариф в настройках.` },
      { status: 403 }
    );
  }

  const camera = await prisma.camera.create({
    data: {
      name,
      location,
      streamUrl,
      branchId,
      venueType: venueType || 'retail',
      resolution: resolution || '1920x1080',
      fps: fps || 30,
      motionThreshold: motionThreshold || 5.0,
      captureInterval: captureInterval || 5,
      organizationId: orgId,
    },
  });

  logAudit({
    organizationId: orgId,
    userId: session.user.id,
    action: 'camera.create',
    entityType: 'camera',
    entityId: camera.id,
    details: { name, location, branchId },
  });

  return NextResponse.json(camera, { status: 201 });
}

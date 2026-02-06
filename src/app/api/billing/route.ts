import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      plan: true,
      subscription: { include: { plan: true } },
      _count: { select: { cameras: true, branches: true, users: true } },
    },
  });

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const activePlan = org.subscription?.plan ?? org.plan;

  const plans = await prisma.plan.findMany({
    orderBy: { pricePerCamera: 'asc' },
  });

  return NextResponse.json({
    currentPlan: {
      id: activePlan?.id ?? null,
      name: activePlan?.name ?? 'free',
      displayName: activePlan?.displayName ?? 'Free',
      maxCameras: activePlan?.maxCameras ?? 2,
      maxBranches: activePlan?.maxBranches ?? 1,
      maxUsers: activePlan?.maxUsers ?? 1,
      pricePerCamera: activePlan?.pricePerCamera ?? 0,
      features: activePlan?.features ?? '[]',
    },
    subscription: org.subscription
      ? {
          id: org.subscription.id,
          status: org.subscription.status,
          currentPeriodEnd: org.subscription.currentPeriodEnd,
          cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
          cameraQuantity: org.subscription.cameraQuantity,
        }
      : null,
    usage: {
      cameras: org._count.cameras,
      branches: org._count.branches,
      users: org._count.users,
    },
    trialEndsAt: org.trialEndsAt,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      maxCameras: p.maxCameras,
      maxBranches: p.maxBranches,
      maxUsers: p.maxUsers,
      pricePerCamera: p.pricePerCamera,
      features: p.features,
    })),
  });
}

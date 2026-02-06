import { prisma } from '@/lib/prisma';

interface PlanLimits {
  maxCameras: number;
  maxBranches: number;
  maxUsers: number;
  currentCameras: number;
  currentBranches: number;
  planName: string;
  canAddCamera: boolean;
  canAddBranch: boolean;
}

const FREE_DEFAULTS = {
  maxCameras: 2,
  maxBranches: 1,
  maxUsers: 1,
};

export async function getOrgPlanLimits(orgId: string): Promise<PlanLimits> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      plan: true,
      _count: { select: { cameras: true, branches: true } },
    },
  });

  if (!org) {
    throw new Error('Organization not found');
  }

  const maxCameras = org.plan?.maxCameras ?? FREE_DEFAULTS.maxCameras;
  const maxBranches = org.plan?.maxBranches ?? FREE_DEFAULTS.maxBranches;
  const maxUsers = org.plan?.maxUsers ?? FREE_DEFAULTS.maxUsers;
  const currentCameras = org._count.cameras;
  const currentBranches = org._count.branches;

  return {
    maxCameras,
    maxBranches,
    maxUsers,
    currentCameras,
    currentBranches,
    planName: org.plan?.displayName ?? 'Free',
    canAddCamera: currentCameras < maxCameras,
    canAddBranch: currentBranches < maxBranches,
  };
}

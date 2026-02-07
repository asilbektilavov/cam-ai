import { prisma } from '@/lib/prisma';

interface TrialStatus {
  allowed: boolean;
  reason?: 'trial_expired' | 'no_subscription';
  daysLeft?: number;
  trialEndsAt?: Date | null;
}

export async function checkTrialOrSubscription(orgId: string): Promise<TrialStatus> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { subscription: true },
  });

  if (!org) {
    return { allowed: false, reason: 'no_subscription' };
  }

  // Active subscription — always allowed
  if (org.subscription && ['active', 'trialing'].includes(org.subscription.status)) {
    return { allowed: true };
  }

  // Check trial period
  if (!org.trialEndsAt) {
    return { allowed: false, reason: 'no_subscription', trialEndsAt: null };
  }

  const now = new Date();
  if (org.trialEndsAt > now) {
    const daysLeft = Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { allowed: true, daysLeft, trialEndsAt: org.trialEndsAt };
  }

  return { allowed: false, reason: 'trial_expired', trialEndsAt: org.trialEndsAt };
}

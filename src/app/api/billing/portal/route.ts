import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { stripe, isStripeEnabled } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (!isStripeEnabled()) {
    return badRequest('Stripe is not configured');
  }

  const orgId = session.user.organizationId;
  const org = await prisma.organization.findUnique({ where: { id: orgId } });

  if (!org?.stripeCustomerId) {
    return badRequest('No billing account found. Subscribe to a plan first.');
  }

  const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || '';

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${origin}/settings?tab=billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}

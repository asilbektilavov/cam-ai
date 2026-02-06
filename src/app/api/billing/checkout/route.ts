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
  const body = await req.json();
  const { planId } = body;

  if (!planId) return badRequest('planId is required');

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.stripePriceId) {
    return badRequest('Invalid plan or plan not available for purchase');
  }

  if (plan.name === 'free') {
    return badRequest('Cannot subscribe to free plan via checkout');
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { _count: { select: { cameras: true } } },
  });

  if (!org) return badRequest('Organization not found');

  // Get or create Stripe customer
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email!,
      name: org.name,
      metadata: { orgId: org.id },
    });
    customerId = customer.id;
    await prisma.organization.update({
      where: { id: orgId },
      data: { stripeCustomerId: customerId },
    });
  }

  // Quantity = current cameras or minimum 1
  const quantity = Math.max(org._count.cameras, 1);

  const origin = req.headers.get('origin') || process.env.NEXTAUTH_URL || '';

  // Check for existing active subscription
  const existingSub = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
  });

  if (existingSub?.stripeSubscriptionId) {
    // Update existing subscription to new plan
    const stripeSub = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
    await stripe.subscriptions.update(existingSub.stripeSubscriptionId, {
      items: [
        { id: stripeSub.items.data[0].id, price: plan.stripePriceId, quantity },
      ],
      proration_behavior: 'create_prorations',
    });

    await prisma.subscription.update({
      where: { id: existingSub.id },
      data: { planId: plan.id, cameraQuantity: quantity },
    });

    await prisma.organization.update({
      where: { id: orgId },
      data: { planId: plan.id },
    });

    return NextResponse.json({ upgraded: true });
  }

  // Create new checkout session
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: plan.stripePriceId,
        quantity,
      },
    ],
    success_url: `${origin}/settings?tab=billing&success=true`,
    cancel_url: `${origin}/settings?tab=billing&canceled=true`,
    metadata: {
      orgId: org.id,
      planId: plan.id,
    },
    subscription_data: {
      metadata: {
        orgId: org.id,
        planId: plan.id,
      },
    },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: checkoutSession.url });
}

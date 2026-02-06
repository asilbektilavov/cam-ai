import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook handler error for ${event.type}:`, err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function extractPeriod(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  return {
    start: item?.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null,
    end: item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
  };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.orgId;
  const planId = session.metadata?.planId;
  if (!orgId || !planId) return;

  const subscriptionId = session.subscription as string;
  if (!subscriptionId) return;

  const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
  const quantity = stripeSub.items.data[0]?.quantity ?? 1;
  const period = extractPeriod(stripeSub);

  await prisma.subscription.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      planId,
      stripeSubscriptionId: subscriptionId,
      status: stripeSub.status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cameraQuantity: quantity,
    },
    update: {
      planId,
      stripeSubscriptionId: subscriptionId,
      status: stripeSub.status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cameraQuantity: quantity,
    },
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      planId,
      stripeCustomerId: session.customer as string,
    },
  });
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.orgId;
  if (!orgId) return;

  const quantity = sub.items.data[0]?.quantity ?? 1;
  const period = extractPeriod(sub);

  await prisma.subscription.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      planId: sub.metadata?.planId || '',
      stripeSubscriptionId: sub.id,
      status: sub.status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      cameraQuantity: quantity,
    },
    update: {
      status: sub.status,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      cameraQuantity: quantity,
    },
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.orgId;
  if (!orgId) return;

  const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: { status: 'canceled' },
  });

  if (freePlan) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { planId: freePlan.id },
    });
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  if (!customerId) return;

  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (org) {
    await prisma.subscription.updateMany({
      where: { organizationId: org.id },
      data: { status: 'past_due' },
    });
  }
}

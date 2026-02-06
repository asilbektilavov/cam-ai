import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding plans...');

  const plans = [
    {
      name: 'free',
      displayName: 'Free',
      maxCameras: 2,
      maxBranches: 1,
      maxUsers: 1,
      pricePerCamera: 0,
      features: JSON.stringify(['basic_analytics', 'email_alerts']),
    },
    {
      name: 'pro',
      displayName: 'Pro',
      maxCameras: 20,
      maxBranches: 5,
      maxUsers: 5,
      pricePerCamera: 1500, // $15.00 in cents
      features: JSON.stringify([
        'basic_analytics',
        'advanced_analytics',
        'person_search',
        'queue_monitor',
        'heatmaps',
        'telegram_alerts',
        'email_alerts',
        'webhook',
      ]),
    },
    {
      name: 'enterprise',
      displayName: 'Enterprise',
      maxCameras: 1000,
      maxBranches: 100,
      maxUsers: 50,
      pricePerCamera: 2500, // $25.00 in cents
      features: JSON.stringify([
        'basic_analytics',
        'advanced_analytics',
        'person_search',
        'queue_monitor',
        'heatmaps',
        'telegram_alerts',
        'email_alerts',
        'webhook',
        'api_access',
        'custom_ai_models',
        'sla',
        'dedicated_support',
      ]),
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: plan,
      create: plan,
    });
    console.log(`  ✓ ${plan.displayName}`);
  }

  console.log('Plans seeded!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

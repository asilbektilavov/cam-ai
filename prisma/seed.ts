import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SETUP_ADMIN_EMAIL || 'admin@demo.com';
  const password = process.env.SETUP_ADMIN_PASSWORD || 'admin123';
  const companyName = process.env.SETUP_COMPANY_NAME || 'Demo Company';

  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36);

  const passwordHash = await bcrypt.hash(password, 10);

  // Check if any organization exists (skip seed if already set up)
  const existingOrg = await prisma.organization.findFirst();
  if (existingOrg) {
    console.log('Database already seeded, skipping.');
    return;
  }

  // Find free plan (seeded by seed-plans.ts)
  const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });

  const org = await prisma.organization.create({
    data: {
      name: companyName,
      slug,
      ...(freePlan ? { planId: freePlan.id } : {}),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.user.create({
    data: {
      email,
      name: 'Администратор',
      passwordHash,
      role: 'admin',
      organizationId: org.id,
    },
  });

  await prisma.branch.create({
    data: {
      name: 'Главный офис',
      organizationId: org.id,
    },
  });

  console.log(`Seed completed: ${email} / ${password} (org: ${companyName})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

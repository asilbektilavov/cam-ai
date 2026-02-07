import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const settings = await prisma.userSettings.findUnique({
    where: { userId: session.user.id },
    select: { twoFactorEnabled: true, ipRestriction: true },
  });

  return NextResponse.json({
    twoFactorEnabled: settings?.twoFactorEnabled ?? false,
    ipRestriction: settings?.ipRestriction ?? false,
  });
}

export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await request.json();
  const { twoFactorEnabled, ipRestriction } = body;

  const settings = await prisma.userSettings.upsert({
    where: { userId: session.user.id },
    update: {
      ...(twoFactorEnabled !== undefined && { twoFactorEnabled }),
      ...(ipRestriction !== undefined && { ipRestriction }),
    },
    create: {
      userId: session.user.id,
      ...(twoFactorEnabled !== undefined && { twoFactorEnabled }),
      ...(ipRestriction !== undefined && { ipRestriction }),
    },
  });

  return NextResponse.json({
    twoFactorEnabled: settings.twoFactorEnabled,
    ipRestriction: settings.ipRestriction,
  });
}

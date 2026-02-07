import { NextResponse } from 'next/server';
import { TOTP, Secret } from 'otpauth';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { logAudit } from '@/lib/audit';

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await request.json();
  const { code } = body;

  if (!code) return badRequest('Код обязателен');

  const settings = await prisma.userSettings.findUnique({
    where: { userId: session.user.id },
    select: { twoFactorSecret: true },
  });

  if (!settings?.twoFactorSecret) {
    return badRequest('2FA не включена');
  }

  const totp = new TOTP({
    issuer: 'CamAI',
    label: session.user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(settings.twoFactorSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });

  if (delta === null) {
    return NextResponse.json({ error: 'Неверный код' }, { status: 400 });
  }

  await prisma.userSettings.update({
    where: { userId: session.user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });

  logAudit({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    action: '2fa.disabled',
    entityType: 'user',
    entityId: session.user.id,
  });

  return NextResponse.json({ success: true });
}

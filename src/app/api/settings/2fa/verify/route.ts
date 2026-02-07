import { NextResponse } from 'next/server';
import { TOTP, Secret } from 'otpauth';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { logAudit } from '@/lib/audit';

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await request.json();
  const { secret, code } = body;

  if (!secret || !code) return badRequest('Secret и code обязательны');

  const totp = new TOTP({
    issuer: 'CamAI',
    label: session.user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 1 });

  if (delta === null) {
    return NextResponse.json({ error: 'Неверный код' }, { status: 400 });
  }

  await prisma.userSettings.upsert({
    where: { userId: session.user.id },
    update: { twoFactorEnabled: true, twoFactorSecret: secret },
    create: { userId: session.user.id, twoFactorEnabled: true, twoFactorSecret: secret },
  });

  logAudit({
    organizationId: session.user.organizationId,
    userId: session.user.id,
    action: '2fa.enabled',
    entityType: 'user',
    entityId: session.user.id,
  });

  return NextResponse.json({ success: true });
}

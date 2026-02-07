import { NextResponse } from 'next/server';
import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function POST() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const secret = new Secret({ size: 20 });

  const totp = new TOTP({
    issuer: 'CamAI',
    label: session.user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const uri = totp.toString();
  const qrCode = await QRCode.toDataURL(uri);

  return NextResponse.json({
    secret: secret.base32,
    uri,
    qrCode,
  });
}

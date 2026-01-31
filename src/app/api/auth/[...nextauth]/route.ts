import { handlers } from '@/lib/auth';
import { authRateLimiter, getClientIp } from '@/lib/rate-limit';
import { NextRequest, NextResponse } from 'next/server';

export const { GET } = handlers;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = authRateLimiter.check(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Слишком много попыток. Повторите через ${rl.retryAfterSeconds} сек.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }
  return handlers.POST(request);
}

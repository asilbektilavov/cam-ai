import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = {
    status: 'ok' as string,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: 'ok' as string,
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    health.status = 'degraded';
    health.checks.database = 'error';
    return NextResponse.json(health, { status: 503 });
  }

  return NextResponse.json(health);
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { storageManager } from '@/lib/services/storage-manager';

export const dynamic = 'force-dynamic';

const STORAGE_CLEANUP_KEY = '__camai_storage_cleanup_started';

export async function GET() {
  // Start auto-cleanup once (survives HMR via process key)
  if (!(process as any)[STORAGE_CLEANUP_KEY]) {
    (process as any)[STORAGE_CLEANUP_KEY] = true;
    storageManager.startAutoCleanup();
  }
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

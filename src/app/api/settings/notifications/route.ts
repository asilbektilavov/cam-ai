import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: session.user.id },
  });

  if (!settings) {
    // Return defaults
    return NextResponse.json({
      critical: true,
      warnings: true,
      info: false,
      system: true,
      dailyReport: false,
      weeklyReport: true,
    });
  }

  return NextResponse.json({
    critical: settings.notifCritical,
    warnings: settings.notifWarnings,
    info: settings.notifInfo,
    system: settings.notifSystem,
    dailyReport: settings.notifDailyReport,
    weeklyReport: settings.notifWeeklyReport,
  });
}

export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await request.json();

  await prisma.userSettings.upsert({
    where: { userId: session.user.id },
    update: {
      notifCritical: body.critical ?? true,
      notifWarnings: body.warnings ?? true,
      notifInfo: body.info ?? false,
      notifSystem: body.system ?? true,
      notifDailyReport: body.dailyReport ?? false,
      notifWeeklyReport: body.weeklyReport ?? true,
    },
    create: {
      userId: session.user.id,
      notifCritical: body.critical ?? true,
      notifWarnings: body.warnings ?? true,
      notifInfo: body.info ?? false,
      notifSystem: body.system ?? true,
      notifDailyReport: body.dailyReport ?? false,
      notifWeeklyReport: body.weeklyReport ?? true,
    },
  });

  return NextResponse.json({ success: true });
}

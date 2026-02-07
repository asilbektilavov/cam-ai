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
    return NextResponse.json({
      language: 'ru',
      timezone: 'utc+5',
      autoRecord: true,
      cloudStorage: true,
      aiQuality: 'high',
    });
  }

  return NextResponse.json({
    language: settings.language,
    timezone: settings.timezone,
    autoRecord: settings.autoRecord,
    cloudStorage: settings.cloudStorage,
    aiQuality: settings.aiQuality,
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
      language: body.language ?? 'ru',
      timezone: body.timezone ?? 'utc+5',
      autoRecord: body.autoRecord ?? true,
      cloudStorage: body.cloudStorage ?? true,
      aiQuality: body.aiQuality ?? 'high',
    },
    create: {
      userId: session.user.id,
      language: body.language ?? 'ru',
      timezone: body.timezone ?? 'utc+5',
      autoRecord: body.autoRecord ?? true,
      cloudStorage: body.cloudStorage ?? true,
      aiQuality: body.aiQuality ?? 'high',
    },
  });

  return NextResponse.json({ success: true });
}

import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { streamManager } from '@/lib/services/stream-manager';
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

  // Handle autoRecord toggle — start/stop recording for all org cameras
  if (typeof body.autoRecord === 'boolean') {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true },
    });
    if (user?.organizationId) {
      if (body.autoRecord === false) {
        // Stop all active recordings
        const recordingCameras = await prisma.camera.findMany({
          where: { organizationId: user.organizationId, isRecording: true },
          select: { id: true },
        });
        for (const cam of recordingCameras) {
          streamManager.stopStream(cam.id).catch(err => {
            console.warn(`[Settings] Failed to stop recording for ${cam.id}:`, err);
          });
        }
      } else {
        // Start recording for all monitored cameras that aren't recording yet
        const monitoredCameras = await prisma.camera.findMany({
          where: { organizationId: user.organizationId, isMonitoring: true, isRecording: false },
          select: { id: true },
        });
        for (const cam of monitoredCameras) {
          const go2rtcUrl = `rtsp://localhost:8554/${cam.id}`;
          streamManager.startStream(cam.id, go2rtcUrl).catch(err => {
            console.warn(`[Settings] Failed to start recording for ${cam.id}:`, err);
          });
        }
      }
    }
  }

  return NextResponse.json({ success: true });
}

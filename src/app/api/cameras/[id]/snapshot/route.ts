import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound } from '@/lib/api-utils';
import { fetchSnapshot } from '@/lib/services/motion-detector';
import { checkPermission, RBACError } from '@/lib/rbac';
import { cameraMonitor } from '@/lib/services/camera-monitor';
import { go2rtcManager } from '@/lib/services/go2rtc-manager';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_cameras');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { streamUrl: true },
  });

  if (!camera) return notFound('Camera not found');

  try {
    // Use cached frame from monitoring pipeline if available (instant, no ffmpeg spawn)
    const cachedFrame = cameraMonitor.getLatestFrame(id);
    if (cachedFrame) {
      return new NextResponse(new Uint8Array(cachedFrame), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // Try go2rtc snapshot — reuses the transcoded stream, no new RTSP session
    const go2rtcFrame = await go2rtcManager.getSnapshot(id);
    if (go2rtcFrame) {
      return new NextResponse(new Uint8Array(go2rtcFrame), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // For RTSP cameras: do NOT fall back to direct ffmpeg here. Spawning an
    // ffmpeg per request floods the camera's tiny RTSP session pool and
    // permanently locks out go2rtc with "454 Session Not Found".
    // Browser will retry on next snapshotTick once go2rtc reconnects.
    if (camera.streamUrl.toLowerCase().startsWith('rtsp://')) {
      return NextResponse.json(
        { error: 'Stream warming up' },
        { status: 503 }
      );
    }

    // HTTP cameras (MJPEG/IP Webcam) are safe — single connection per request.
    const imageBuffer = await fetchSnapshot(camera.streamUrl, id);

    return new NextResponse(new Uint8Array(imageBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Camera unreachable' },
      { status: 502 }
    );
  }
}

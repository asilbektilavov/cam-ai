import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isMainStreamPrimary } from '@/lib/services/main-stream-primary';

// attendance-service ALWAYS reads through the go2rtc proxy. The DSS substream
// caps at 2 concurrent RTSP sessions; the recorder takes one directly, and
// every additional consumer (browser preview, attendance, etc.) shares the
// proxy's single connection. Direct RTSP from attendance was burning the
// second slot and starving go2rtc, which surfaced as constant 454 errors
// in browser previews.
const GO2RTC_RTSP_HOST = process.env.GO2RTC_RTSP_HOST || '172.18.0.1';
const GO2RTC_RTSP_PORT = process.env.GO2RTC_RTSP_PORT || '8554';

// GET /api/attendance/cameras — list active attendance + people_search cameras (for attendance-service auto-recovery)
export async function GET() {
  const cameras = await prisma.camera.findMany({
    where: {
      purpose: { in: ['attendance_entry', 'attendance_exit', 'people_search'] },
      isMonitoring: true,
    },
    select: {
      id: true,
      name: true,
      streamUrl: true,
      useGo2rtcForStream: true,
      purpose: true,
      onvifHost: true,
      onvifPort: true,
      onvifUser: true,
      onvifPass: true,
      visitorMinFacePx: true,
    },
  });

  return NextResponse.json(
    cameras.map((c) => {
      // Visitor counter (people_search) reads MAIN at 1920x1080 — faces on
      // the 800x448 substream are too small (28-34 px) for the HOG detector.
      // attendance_entry/_exit stay on substream because those cameras are
      // mounted close to the doorway and faces fill the frame already.
      // Cameras enrolled in the MAIN_STREAM_PRIMARY test serve MAIN under the
      // bare `<id>` name (no -main suffix), so the bare id IS the main feed.
      const streamId =
        c.purpose === 'people_search' && !isMainStreamPrimary(c.id)
          ? `${c.id}-main`
          : c.id;
      return {
        id: c.id,
        name: c.name,
        streamUrl: `rtsp://${GO2RTC_RTSP_HOST}:${GO2RTC_RTSP_PORT}/${streamId}`,
        direction: c.purpose === 'attendance_entry' ? 'entry'
          : c.purpose === 'attendance_exit' ? 'exit'
          : 'search',
        onvifHost: c.onvifHost || '',
        onvifPort: c.onvifPort || 80,
        onvifUser: c.onvifUser || 'admin',
        onvifPass: c.onvifPass || '',
        visitorMinFacePx: c.visitorMinFacePx,
      };
    })
  );
}

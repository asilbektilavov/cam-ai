export async function register() {
  // Only run on the server (not during build or on edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('@/lib/prisma');
    const { cameraMonitor } = await import('@/lib/services/camera-monitor');
    const { notificationDispatcher } = await import('@/lib/services/notification-dispatcher');

    // Start notification dispatcher
    notificationDispatcher.start();

    // Start Telegram bot subscriber polling
    const { startTelegramBotPolling } = await import('@/lib/services/telegram-bot');
    startTelegramBotPolling();

    // Resume monitoring for cameras that had monitoring enabled.
    // Only "detection" purpose uses CameraMonitor — other purposes
    // (line_crossing, lpr, attendance_*) own their own monitoring loops
    // in dedicated services. Calling startMonitoring on them spawns an
    // ffmpeg grabber per camera that floods the camera's RTSP session pool.
    try {
      const cameras = await prisma.camera.findMany({
        where: { isMonitoring: true, purpose: 'detection' },
      });

      for (const camera of cameras) {
        await cameraMonitor.startMonitoring(camera.id);
      }

      if (cameras.length > 0) {
        console.log(
          `[Init] Resumed monitoring for ${cameras.length} detection camera(s)`
        );
      }

      // Re-register go2rtc streams for non-detection cameras (line_crossing,
      // lpr, attendance_*). go2rtc persists its config but a fresh container
      // (or an unhealthy stream) needs to be told about every camera again.
      const otherCameras = await prisma.camera.findMany({
        where: { isMonitoring: true, purpose: { not: 'detection' } },
      });
      if (otherCameras.length > 0) {
        const { go2rtcManager } = await import('@/lib/services/go2rtc-manager');
        await Promise.allSettled(
          otherCameras.map((c) => go2rtcManager.addStream(c.id, c.streamUrl))
        );
        console.log(
          `[Init] Re-registered go2rtc streams for ${otherCameras.length} camera(s)`
        );
      }

      // Resume HLS recording for any camera marked isRecording=true. The DB
      // flag survived restart but the ffmpeg child process did not, so the
      // archive silently stopped growing.
      //
      // Use the camera's direct RTSP URL (not the go2rtc proxy). The proxy
      // requires go2rtc to have an active producer, and on cold start ffmpeg
      // hits go2rtc before that — gets "Invalid data" and StreamManager
      // marks the stream non-recoverable. Direct RTSP costs one extra session
      // per camera but starts reliably.
      const recordingCameras = await prisma.camera.findMany({
        where: { isRecording: true },
        select: { id: true, name: true },
      });
      if (recordingCameras.length > 0) {
        const { streamManager } = await import('@/lib/services/stream-manager');
        for (const cam of recordingCameras) {
          streamManager.startStream(cam.id).catch((err) =>
            console.warn(
              `[Init] Failed to resume recording for ${cam.name}:`,
              err instanceof Error ? err.message : err
            )
          );
        }
        console.log(
          `[Init] Resumed HLS recording for ${recordingCameras.length} camera(s)`
        );
      }

      // Reconcile attendance-service: stop stale watchers not in DB
      const { reconcileAttendanceCameras } = await import(
        '@/lib/services/attendance-reconciler'
      );
      await reconcileAttendanceCameras();
    } catch (error) {
      console.error('[Init] Failed to resume camera monitoring:', error);
    }

    // Start sync worker on satellite instances
    if (
      process.env.INSTANCE_ROLE === 'satellite' &&
      process.env.SYNC_TO &&
      process.env.SYNC_KEY
    ) {
      const { syncWorker } = await import('@/lib/services/sync-worker');
      syncWorker.start();
    }

    // Auto-generate INSTANCE_ID if not set
    if (!process.env.INSTANCE_ID) {
      const { randomUUID } = await import('crypto');
      process.env.INSTANCE_ID = randomUUID();
    }
  }
}

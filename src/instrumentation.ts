export async function register() {
  // Only run on the server (not during build or on edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('@/lib/prisma');
    const { cameraMonitor } = await import('@/lib/services/camera-monitor');
    const { notificationDispatcher } = await import('@/lib/services/notification-dispatcher');

    // Start notification dispatcher
    notificationDispatcher.start();

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

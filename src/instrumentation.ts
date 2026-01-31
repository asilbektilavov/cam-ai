export async function register() {
  // Only run on the server (not during build or on edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('@/lib/prisma');
    const { cameraMonitor } = await import('@/lib/services/camera-monitor');
    const { notificationDispatcher } = await import('@/lib/services/notification-dispatcher');

    // Start notification dispatcher
    notificationDispatcher.start();

    // Resume monitoring for cameras that had monitoring enabled
    try {
      const cameras = await prisma.camera.findMany({
        where: { isMonitoring: true },
      });

      for (const camera of cameras) {
        await cameraMonitor.startMonitoring(camera.id);
      }

      if (cameras.length > 0) {
        console.log(
          `[Init] Resumed monitoring for ${cameras.length} camera(s)`
        );
      }
    } catch (error) {
      console.error('[Init] Failed to resume camera monitoring:', error);
    }
  }
}

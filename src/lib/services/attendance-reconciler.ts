/**
 * Reconciles attendance-service camera watchers with the actual DB state.
 * Stops watchers for cameras that no longer exist or aren't monitoring.
 * Should be called on server startup and when cameras are changed.
 */

const ATTENDANCE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:8002';

interface AttendanceHealth {
  cameras: Record<string, { direction: string; alive: boolean }>;
}

export async function reconcileAttendanceCameras(): Promise<void> {
  try {
    // 1. Get watchers from attendance-service
    const healthResp = await fetch(`${ATTENDANCE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!healthResp.ok) return;
    const health: AttendanceHealth = await healthResp.json();
    const watcherIds = Object.keys(health.cameras);
    if (watcherIds.length === 0) return;

    // 2. Get valid camera IDs from DB (attendance/search cameras that are monitoring)
    const { prisma } = await import('@/lib/prisma');
    const validCameras = await prisma.camera.findMany({
      where: {
        isMonitoring: true,
        purpose: { in: ['attendance_entry', 'attendance_exit', 'people_search'] },
      },
      select: { id: true },
    });
    const validIds = new Set(validCameras.map((c) => c.id));

    // 3. Stop watchers that don't belong
    const staleIds = watcherIds.filter((id) => !validIds.has(id));
    if (staleIds.length === 0) return;

    console.log(`[AttendanceReconcile] Stopping ${staleIds.length} stale watcher(s)`);
    await Promise.allSettled(
      staleIds.map((id) =>
        fetch(`${ATTENDANCE_URL}/cameras/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `camera_id=${id}`,
          signal: AbortSignal.timeout(3000),
        })
      )
    );
  } catch {
    // attendance-service may not be running — ignore
  }
}

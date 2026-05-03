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

      // Re-register go2rtc streams for every camera that needs one: all the
      // non-detection purposes (line_crossing, lpr, attendance_*) plus any
      // detection camera with useGo2rtcForStream=true. go2rtc persists its
      // config but a fresh container (or an unhealthy stream) needs to be
      // told about every camera again.
      const otherCameras = await prisma.camera.findMany({
        where: {
          isMonitoring: true,
          OR: [
            { purpose: { not: 'detection' } },
            { useGo2rtcForStream: true },
          ],
        },
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

      // Resume HLS recording for every monitoring camera. We used to gate
      // this on isRecording=true, but graceful container shutdown reset that
      // flag — so every redeploy silently killed the archive forever. Tying
      // recording to isMonitoring matches operator intent (autoRecord
      // defaults true) and is idempotent: streamManager bails early if the
      // camera is already streaming.
      //
      // StreamManager honours camera.useGo2rtcForStream — if go2rtc is the
      // chosen path it will use the proxy URL. Cold start risk: the proxy
      // producer needs to be warm before ffmpeg connects, otherwise we get
      // "Invalid data" and the stream is marked non-recoverable. The
      // re-registration loop above runs first to give go2rtc a head start.
      const recordingCameras = await prisma.camera.findMany({
        where: { isMonitoring: true },
        select: { id: true, name: true },
      });
      if (recordingCameras.length > 0) {
        const { streamManager } = await import('@/lib/services/stream-manager');
        // Stagger boot recording start: 8s pause for go2rtc to warm, then
        // launch one camera per second. Firing all 16 at once hammers
        // go2rtc's transcoders, the network, and the camera RTSP pools in
        // parallel, kicking everyone into a 454/Invalid-data death loop.
        setTimeout(() => {
          recordingCameras.forEach((cam, i) => {
            setTimeout(() => {
              streamManager.startStream(cam.id).catch((err) =>
                console.warn(
                  `[Init] Failed to resume recording for ${cam.name}:`,
                  err instanceof Error ? err.message : err
                )
              );
            }, i * 1_000);
          });
          console.log(
            `[Init] Resuming HLS recording for ${recordingCameras.length} camera(s) (staggered 1s apart)`
          );
        }, 8_000);
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

    // Periodic camera reachability healthcheck. Status field was set to
    // "online" once at monitoring start and never updated when the camera
    // went physically offline. We TCP-ping each camera's RTSP port every
    // 15s, update Camera.status when it changes, and stash the per-camera
    // round-trip into a process-level cache that /api/cameras/health serves
    // to the dashboard ping panel.
    const HEALTHCHECK_KEY = '__cameraHealthcheckTimer';
    const HEALTH_CACHE_KEY = '__cameraHealthCache';
    const proc = process as unknown as {
      [HEALTHCHECK_KEY]?: ReturnType<typeof setInterval>;
      [HEALTH_CACHE_KEY]?: Map<string, { latencyMs: number | null; alive: boolean; checkedAt: number }>;
    };
    if (proc[HEALTHCHECK_KEY]) clearInterval(proc[HEALTHCHECK_KEY]);
    if (!proc[HEALTH_CACHE_KEY]) proc[HEALTH_CACHE_KEY] = new Map();
    const cache = proc[HEALTH_CACHE_KEY];
    const net = await import('net');
    const measureOne = (host: string, port: number): Promise<{ alive: boolean; latencyMs: number | null }> =>
      new Promise((resolve) => {
        const sock = new net.Socket();
        const t0 = Date.now();
        const done = (alive: boolean) => {
          const latencyMs = alive ? Date.now() - t0 : null;
          try { sock.destroy(); } catch {}
          resolve({ alive, latencyMs });
        };
        sock.setTimeout(2500);
        sock.once('connect', () => done(true));
        sock.once('timeout', () => done(false));
        sock.once('error', () => done(false));
        sock.connect(port, host);
      });
    const runHealthcheck = async (): Promise<void> => {
      try {
        const cams = await prisma.camera.findMany({
          where: { isMonitoring: true },
          select: { id: true, status: true, streamUrl: true },
        });
        // Probe HTTP (web UI port 80), NOT RTSP (554). DSS substream tops out
        // at 2 concurrent RTSP sessions — recorder + go2rtc already hold both,
        // so a parallel healthcheck on 554 just times out and falsely flags
        // every camera offline. Port 80 is the camera web UI, always served,
        // separate from the RTSP session pool.
        await Promise.all(
          cams.map(async (c) => {
            const m = c.streamUrl.match(/@?([0-9.]+):/);
            if (!m) return;
            const { alive, latencyMs } = await measureOne(m[1], 80);
            cache.set(c.id, { alive, latencyMs, checkedAt: Date.now() });
            const want = alive ? 'online' : 'offline';
            if (c.status !== want) {
              await prisma.camera.update({ where: { id: c.id }, data: { status: want } });
            }
          })
        );
      } catch (err) {
        console.warn('[Healthcheck] error:', err instanceof Error ? err.message : err);
      }
    };
    proc[HEALTHCHECK_KEY] = setInterval(runHealthcheck, 15_000);
    setTimeout(runHealthcheck, 5_000); // initial run shortly after boot
    console.log('[Init] Camera reachability healthcheck started (15s interval)');
  }
}

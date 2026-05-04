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

        // Visitor-counter cameras (people_search) need a separate go2rtc
        // stream pointing at the camera's MAIN sub-channel (1920x1080) so
        // the face detector has enough pixels per face — substream's
        // 800x448 makes faces too small for HOG to find. We register
        // `<id>-main` next to `<id>` and the attendance-cameras endpoint
        // hands out the -main URL for people_search cameras.
        const visitorCams = otherCameras.filter((c) => c.purpose === 'people_search');
        if (visitorCams.length > 0) {
          await Promise.allSettled(
            visitorCams.map((c) => {
              const mainUrl = c.streamUrl.replace(/\/SUB(\?|$)/, '/MAIN$1');
              return go2rtcManager.addStream(`${c.id}-main`, mainUrl);
            })
          );
          console.log(
            `[Init] Re-registered MAIN go2rtc streams for ${visitorCams.length} visitor-counter camera(s)`
          );
        }

        // Drop zombie streams (stale registrations from deleted cameras).
        // These accumulate in go2rtc.yaml because the manager only adds —
        // never prunes. A zombie with the wrong RTSP path can keep retrying
        // a real camera's IP and steal a substream slot, which manifests as
        // periodic 1-2s loading on the live preview. Compare go2rtc's stream
        // list against the DB and delete anything not in the DB. Keep the
        // `<id>-main` aliases we registered above.
        try {
          const proxyApiCleanup =
            process.env.GO2RTC_API_URL ||
            `http://${process.env.GO2RTC_RTSP_HOST || '172.18.0.1'}:1984`;
          const wantedIds = new Set(otherCameras.map((c) => c.id));
          for (const c of visitorCams) wantedIds.add(`${c.id}-main`);
          const sres = await fetch(`${proxyApiCleanup}/api/streams`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (sres.ok) {
            const streams = (await sres.json()) as Record<string, unknown>;
            const zombies = Object.keys(streams).filter(
              (id) => !wantedIds.has(id)
            );
            if (zombies.length > 0) {
              await Promise.allSettled(
                zombies.map((id) =>
                  fetch(
                    `${proxyApiCleanup}/api/streams?src=${encodeURIComponent(id)}`,
                    { method: 'DELETE', signal: AbortSignal.timeout(3_000) }
                  )
                )
              );
              console.log(
                `[Init] Pruned ${zombies.length} zombie go2rtc stream(s): ${zombies.join(', ')}`
              );
            }
          }
        } catch (err) {
          console.warn(
            '[Init] go2rtc zombie cleanup failed:',
            err instanceof Error ? err.message : err
          );
        }

        // Pre-warm: actively pull a snapshot from each go2rtc stream so its
        // producer connects to the camera before recorder/attendance ffmpeg
        // start. Without this, downstream consumers race the producer and
        // get 404 / "Invalid data" → 5-min backoff. Hitting frame.jpeg also
        // makes us a real consumer, which keeps lazy producers alive long
        // enough for the next consumer to attach.
        const proxyHost = process.env.GO2RTC_RTSP_HOST || '172.18.0.1';
        const proxyApi = process.env.GO2RTC_API_URL || `http://${proxyHost}:1984`;
        const PRE_WARM_DEADLINE_MS = 60_000;
        const PER_TRY_TIMEOUT_MS = 8_000;
        const wantIds = otherCameras.map((c) => c.id);
        const warmedIds = new Set<string>();
        const t0 = Date.now();

        async function pingOne(id: string): Promise<void> {
          if (warmedIds.has(id)) return;
          try {
            const res = await fetch(
              `${proxyApi}/api/frame.jpeg?src=${encodeURIComponent(id)}`,
              { signal: AbortSignal.timeout(PER_TRY_TIMEOUT_MS) }
            );
            if (res.ok) {
              const buf = await res.arrayBuffer();
              if (buf.byteLength > 1_000) warmedIds.add(id);
            }
          } catch {
            /* camera unreachable, will be retried next pass */
          }
        }

        // First pass: hit every stream in parallel with batched-of-4 to keep
        // the camera RTSP pools and our CPU sane.
        for (let i = 0; i < wantIds.length; i += 4) {
          const batch = wantIds.slice(i, i + 4);
          await Promise.all(batch.map(pingOne));
        }
        // Retry stragglers until deadline
        while (
          warmedIds.size < wantIds.length &&
          Date.now() - t0 < PRE_WARM_DEADLINE_MS
        ) {
          await new Promise((r) => setTimeout(r, 2_000));
          const stragglers = wantIds.filter((id) => !warmedIds.has(id));
          for (let i = 0; i < stragglers.length; i += 4) {
            const batch = stragglers.slice(i, i + 4);
            await Promise.all(batch.map(pingOne));
          }
        }
        console.log(
          `[Init] go2rtc pre-warm: ${warmedIds.size}/${wantIds.length} producers ready ` +
            `in ${Math.round((Date.now() - t0) / 1000)}s`
        );

        // Keep producers alive: poll every 20s and re-ping any stream that
        // has gone cold. go2rtc producers shut down once consumers drop —
        // when a recorder is in backoff there's nothing else holding the
        // producer, so the next recorder retry hits a 404 and the cycle
        // repeats. By staying as a "background consumer" we keep producers
        // warm and break the loop.
        const KEEP_ALIVE_MS = 20_000;
        const proc = process as unknown as {
          __go2rtcKeepAliveTimer?: ReturnType<typeof setInterval>;
        };
        if (proc.__go2rtcKeepAliveTimer) clearInterval(proc.__go2rtcKeepAliveTimer);
        proc.__go2rtcKeepAliveTimer = setInterval(() => {
          (async () => {
            try {
              const sres = await fetch(`${proxyApi}/api/streams`, {
                signal: AbortSignal.timeout(2000),
              });
              if (!sres.ok) return;
              const streams = (await sres.json()) as Record<
                string,
                { producers?: Array<{ bytes_recv?: number }> }
              >;
              const cold = wantIds.filter((id) => {
                const recv = streams[id]?.producers?.[0]?.bytes_recv ?? 0;
                return recv < 1; // never received any data → producer dead/lazy
              });
              if (cold.length > 0) {
                for (let i = 0; i < cold.length; i += 4) {
                  const batch = cold.slice(i, i + 4);
                  await Promise.all(batch.map(pingOne));
                }
              }
            } catch {
              /* ignore — try next tick */
            }
          })().catch(() => {});
        }, KEEP_ALIVE_MS);
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
        // The pre-warm loop above already blocked until go2rtc producers
        // had bytes flowing, so we can launch recorders immediately. Still
        // staggered 1s apart to avoid a synchronous spike of 16 ffmpeg
        // spawns (mostly a CPU/disk-IO concern, not a network one).
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

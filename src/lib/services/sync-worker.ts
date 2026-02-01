import { prisma } from '@/lib/prisma';

interface SyncPayload {
  instanceId: string;
  branchName: string;
  branchAddress: string | null;
  organizationName: string;
  cameras: Array<{
    id: string;
    name: string;
    location: string;
    status: string;
    isMonitoring: boolean;
  }>;
  events: Array<{
    id: string;
    cameraName: string;
    cameraLocation: string;
    type: string;
    severity: string;
    description: string;
    timestamp: string;
    metadata: string | null;
  }>;
}

class SyncWorker {
  private static instance: SyncWorker;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private isSyncing = false;
  private lastSyncAt: Date | null = null;
  private lastError: string | null = null;

  static getInstance(): SyncWorker {
    if (!SyncWorker.instance) {
      SyncWorker.instance = new SyncWorker();
    }
    return SyncWorker.instance;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const interval = parseInt(process.env.SYNC_INTERVAL || '300') * 1000;

    // Initial sync after 30 seconds
    setTimeout(() => void this.sync(), 30_000);

    // Recurring sync
    this.timer = setInterval(() => void this.sync(), interval);

    console.log(`[SyncWorker] Started (interval: ${interval / 1000}s, target: ${process.env.SYNC_TO})`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  getStatus() {
    return {
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      isSyncing: this.isSyncing,
    };
  }

  private async sync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    let payload: SyncPayload | null = null;

    try {
      payload = await this.buildPayload();
      await this.push(payload);

      // Success — clear queue
      await prisma.syncQueue.deleteMany();
      this.lastSyncAt = new Date();
      this.lastError = null;

      console.log(`[SyncWorker] Sync OK (${payload.events.length} events, ${payload.cameras.length} cameras)`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.lastError = errorMsg;
      console.error(`[SyncWorker] Sync failed: ${errorMsg}`);

      // Queue for retry
      if (payload) {
        await this.enqueue(payload);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async buildPayload(): Promise<SyncPayload> {
    const since = this.lastSyncAt || new Date(Date.now() - 5 * 60 * 1000);

    const [org, branch, events, cameras] = await Promise.all([
      prisma.organization.findFirst(),
      prisma.branch.findFirst(),
      prisma.event.findMany({
        where: { timestamp: { gte: since } },
        include: { camera: { select: { name: true, location: true } } },
        orderBy: { timestamp: 'desc' },
        take: 500,
      }),
      prisma.camera.findMany({
        select: { id: true, name: true, location: true, status: true, isMonitoring: true },
      }),
    ]);

    return {
      instanceId: process.env.INSTANCE_ID || 'unknown',
      branchName: branch?.name || org?.name || 'Unknown',
      branchAddress: branch?.address || null,
      organizationName: org?.name || 'Unknown',
      cameras: cameras.map((c) => ({
        id: c.id,
        name: c.name,
        location: c.location,
        status: c.status,
        isMonitoring: c.isMonitoring,
      })),
      events: events.map((e) => ({
        id: e.id,
        cameraName: e.camera.name,
        cameraLocation: e.camera.location,
        type: e.type,
        severity: e.severity,
        description: e.description,
        timestamp: e.timestamp.toISOString(),
        metadata: e.metadata,
      })),
    };
  }

  private async push(payload: SyncPayload): Promise<void> {
    const syncTo = process.env.SYNC_TO;
    const syncKey = process.env.SYNC_KEY;
    if (!syncTo || !syncKey) {
      throw new Error('SYNC_TO and SYNC_KEY must be set');
    }

    const res = await fetch(`${syncTo}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Key': syncKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    }
  }

  private async enqueue(payload: SyncPayload): Promise<void> {
    try {
      await prisma.syncQueue.create({
        data: { payload: JSON.stringify(payload) },
      });

      // Keep max 100 entries
      const old = await prisma.syncQueue.findMany({
        orderBy: { createdAt: 'desc' },
        skip: 100,
        select: { id: true },
      });
      if (old.length > 0) {
        await prisma.syncQueue.deleteMany({
          where: { id: { in: old.map((o) => o.id) } },
        });
      }
    } catch (e) {
      console.error('[SyncWorker] Failed to enqueue:', e);
    }
  }
}

export const syncWorker = SyncWorker.getInstance();

/**
 * Singleton service for server failover management.
 * Maintains an in-memory registry of servers, performs periodic health checks,
 * and handles automatic failover from primary to backup when failures are detected.
 * Emits 'server-down', 'server-recovered', 'failover-triggered' events.
 */

import { EventEmitter } from 'events';

const DEFAULT_HEALTH_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
// Number of consecutive failures before marking a server as offline
const FAILURE_THRESHOLD = 3;
// Number of consecutive successes before marking a degraded server as online
const RECOVERY_THRESHOLD = 2;

export type ServerRole = 'primary' | 'backup';
export type ServerStatus = 'online' | 'offline' | 'degraded' | 'unknown';

export interface ServerInfo {
  id: string;
  url: string;
  role: ServerRole;
  status: ServerStatus;
  lastCheckedAt: number | null;
  lastOnlineAt: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  registeredAt: number;
  healthHistory: HealthCheckEntry[];
}

export interface HealthCheckEntry {
  timestamp: number;
  status: ServerStatus;
  responseTimeMs: number | null;
  error: string | null;
}

export interface FailoverEvent {
  type: 'server-down' | 'server-recovered' | 'failover-triggered';
  serverId: string;
  serverUrl: string;
  role: ServerRole;
  previousStatus: ServerStatus;
  newStatus: ServerStatus;
  timestamp: number;
  details?: string;
}

// Maximum health history entries per server
const MAX_HEALTH_HISTORY = 100;

class FailoverManager extends EventEmitter {
  private static instance: FailoverManager;

  /** In-memory server registry. */
  private servers = new Map<string, ServerInfo>();

  /** Monitoring interval handle. */
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private monitoringIntervalMs = DEFAULT_HEALTH_INTERVAL_MS;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  static getInstance(): FailoverManager {
    if (!FailoverManager.instance) {
      FailoverManager.instance = new FailoverManager();
    }
    return FailoverManager.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Register a server in the failover pool.
   */
  registerServer(id: string, url: string, role: ServerRole): ServerInfo {
    const existing = this.servers.get(id);
    if (existing) {
      // Update existing server
      existing.url = url;
      existing.role = role;
      console.log(`[FailoverManager] Updated server ${id} (${role}) at ${url}`);
      return existing;
    }

    const server: ServerInfo = {
      id,
      url,
      role,
      status: 'unknown',
      lastCheckedAt: null,
      lastOnlineAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      registeredAt: Date.now(),
      healthHistory: [],
    };

    this.servers.set(id, server);
    console.log(`[FailoverManager] Registered server ${id} (${role}) at ${url}`);
    return server;
  }

  /**
   * Unregister a server from the failover pool.
   */
  unregisterServer(id: string): boolean {
    const deleted = this.servers.delete(id);
    if (deleted) {
      console.log(`[FailoverManager] Unregistered server ${id}`);
    }
    return deleted;
  }

  /**
   * Perform a health check on a specific server.
   */
  async checkHealth(serverId: string): Promise<ServerStatus> {
    const server = this.servers.get(serverId);
    if (!server) {
      console.warn(`[FailoverManager] Server ${serverId} not found`);
      return 'unknown';
    }

    const previousStatus = server.status;
    const t0 = Date.now();
    let responseTimeMs: number | null = null;
    let error: string | null = null;
    let newStatus: ServerStatus;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(`${server.url}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      responseTimeMs = Date.now() - t0;

      if (response.ok) {
        server.consecutiveSuccesses++;
        server.consecutiveFailures = 0;
        server.lastOnlineAt = Date.now();

        if (server.status === 'degraded' && server.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
          newStatus = 'online';
        } else if (server.status === 'offline' && server.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
          newStatus = 'online';
        } else if (server.status === 'unknown') {
          newStatus = 'online';
        } else {
          newStatus = server.status === 'offline' || server.status === 'degraded' ? 'degraded' : 'online';
        }
      } else {
        error = `HTTP ${response.status}`;
        server.consecutiveFailures++;
        server.consecutiveSuccesses = 0;
        newStatus = server.consecutiveFailures >= FAILURE_THRESHOLD ? 'offline' : 'degraded';
      }
    } catch (err) {
      responseTimeMs = Date.now() - t0;
      error = (err as Error).name === 'AbortError'
        ? 'Health check timeout'
        : (err as Error).message;
      server.consecutiveFailures++;
      server.consecutiveSuccesses = 0;
      newStatus = server.consecutiveFailures >= FAILURE_THRESHOLD ? 'offline' : 'degraded';
    }

    server.status = newStatus;
    server.lastCheckedAt = Date.now();

    // Record health history
    const entry: HealthCheckEntry = {
      timestamp: Date.now(),
      status: newStatus,
      responseTimeMs,
      error,
    };
    server.healthHistory.push(entry);
    if (server.healthHistory.length > MAX_HEALTH_HISTORY) {
      server.healthHistory.splice(0, server.healthHistory.length - MAX_HEALTH_HISTORY);
    }

    // Emit events based on status transitions
    if (previousStatus !== 'offline' && newStatus === 'offline') {
      const event: FailoverEvent = {
        type: 'server-down',
        serverId: server.id,
        serverUrl: server.url,
        role: server.role,
        previousStatus,
        newStatus,
        timestamp: Date.now(),
        details: error || undefined,
      };
      this.emit('server-down', event);
      console.log(`[FailoverManager] SERVER DOWN: ${server.id} (${server.role}) at ${server.url}`);

      // If the primary goes down, attempt automatic failover
      if (server.role === 'primary') {
        void this.attemptAutoFailover(server.id);
      }
    }

    if ((previousStatus === 'offline' || previousStatus === 'degraded') && newStatus === 'online') {
      const event: FailoverEvent = {
        type: 'server-recovered',
        serverId: server.id,
        serverUrl: server.url,
        role: server.role,
        previousStatus,
        newStatus,
        timestamp: Date.now(),
      };
      this.emit('server-recovered', event);
      console.log(`[FailoverManager] SERVER RECOVERED: ${server.id} (${server.role}) at ${server.url}`);
    }

    return newStatus;
  }

  /**
   * Start periodic health monitoring for all registered servers.
   */
  startMonitoring(intervalMs: number = DEFAULT_HEALTH_INTERVAL_MS): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringIntervalMs = intervalMs;

    this.monitoringInterval = setInterval(async () => {
      await this.checkAllServers();
    }, this.monitoringIntervalMs);

    // Run an immediate check
    void this.checkAllServers();

    console.log(`[FailoverManager] Started monitoring (interval=${intervalMs}ms, servers=${this.servers.size})`);
  }

  /**
   * Stop periodic health monitoring.
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[FailoverManager] Stopped monitoring');
    }
  }

  /**
   * Get the status of all registered servers.
   */
  getStatus(): ServerInfo[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get a single server's info.
   */
  getServer(serverId: string): ServerInfo | null {
    return this.servers.get(serverId) || null;
  }

  /**
   * Get all servers with a specific role.
   */
  getServersByRole(role: ServerRole): ServerInfo[] {
    return Array.from(this.servers.values()).filter((s) => s.role === role);
  }

  /**
   * Get the current primary server (first online primary, or first primary).
   */
  getPrimary(): ServerInfo | null {
    const primaries = this.getServersByRole('primary');
    const onlinePrimary = primaries.find((s) => s.status === 'online');
    return onlinePrimary || primaries[0] || null;
  }

  /**
   * Promote a backup server to primary role.
   * The current primary (if any) is demoted to backup.
   */
  promoteBackup(serverId: string): boolean {
    const backup = this.servers.get(serverId);
    if (!backup) {
      console.warn(`[FailoverManager] Server ${serverId} not found`);
      return false;
    }

    if (backup.role !== 'backup') {
      console.warn(`[FailoverManager] Server ${serverId} is not a backup (role=${backup.role})`);
      return false;
    }

    // Demote current primary(s) to backup
    const allServers = Array.from(this.servers.values());
    for (const server of allServers) {
      if (server.role === 'primary' && server.id !== serverId) {
        server.role = 'backup';
        console.log(`[FailoverManager] Demoted ${server.id} to backup`);
      }
    }

    // Promote the backup
    backup.role = 'primary';

    const event: FailoverEvent = {
      type: 'failover-triggered',
      serverId: backup.id,
      serverUrl: backup.url,
      role: 'primary',
      previousStatus: backup.status,
      newStatus: backup.status,
      timestamp: Date.now(),
      details: `Promoted from backup to primary`,
    };
    this.emit('failover-triggered', event);

    console.log(`[FailoverManager] FAILOVER: Promoted ${backup.id} to primary`);
    return true;
  }

  /**
   * Check if monitoring is currently active.
   */
  isMonitoring(): boolean {
    return this.monitoringInterval !== null;
  }

  /**
   * Clear all servers and stop monitoring.
   */
  clearAll(): void {
    this.stopMonitoring();
    this.servers.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async checkAllServers(): Promise<void> {
    const serverIds = Array.from(this.servers.keys());
    await Promise.allSettled(
      serverIds.map((id) => this.checkHealth(id))
    );
  }

  /**
   * Attempt automatic failover: find the healthiest backup and promote it.
   */
  private async attemptAutoFailover(downPrimaryId: string): Promise<void> {
    const backups = this.getServersByRole('backup');
    const onlineBackups = backups.filter((s) => s.status === 'online');

    if (onlineBackups.length === 0) {
      console.warn(
        `[FailoverManager] No online backup servers available for failover (primary=${downPrimaryId})`
      );
      return;
    }

    // Pick the backup with the most recent lastOnlineAt
    const best = onlineBackups.sort(
      (a, b) => (b.lastOnlineAt || 0) - (a.lastOnlineAt || 0)
    )[0];

    console.log(
      `[FailoverManager] Auto-failover: promoting ${best.id} to replace offline primary ${downPrimaryId}`
    );

    this.promoteBackup(best.id);
  }
}

const globalForFailover = globalThis as unknown as {
  failoverManager: FailoverManager | undefined;
};

export const failoverManager =
  globalForFailover.failoverManager ?? FailoverManager.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForFailover.failoverManager = failoverManager;

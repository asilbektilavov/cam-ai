import { prisma } from '@/lib/prisma';
import { readdir, stat, rm } from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageUsage {
  totalBytes: number;
  recordingCount: number;
  oldestRecording: Date | null;
}

export interface CameraStorageUsage {
  cameraId: string;
  cameraName: string;
  totalBytes: number;
  recordingCount: number;
}

export interface DiskUsage {
  total: number;
  used: number;
  free: number;
  percent: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), 'data');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const DEFAULT_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// StorageManager — singleton
// ---------------------------------------------------------------------------

class StorageManager {
  private static instance: StorageManager;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  // -----------------------------------------------------------------------
  // Storage usage queries
  // -----------------------------------------------------------------------

  /** Get total storage usage for an organization. */
  async getUsage(organizationId: string): Promise<StorageUsage> {
    const result = await prisma.recording.aggregate({
      where: { organizationId },
      _sum: { fileSize: true },
      _count: { id: true },
      _min: { startedAt: true },
    });

    return {
      totalBytes: Number(result._sum.fileSize ?? 0),
      recordingCount: result._count.id,
      oldestRecording: result._min.startedAt ?? null,
    };
  }

  /** Get storage usage for a specific camera. */
  async getCameraUsage(cameraId: string): Promise<StorageUsage> {
    const result = await prisma.recording.aggregate({
      where: { cameraId },
      _sum: { fileSize: true },
      _count: { id: true },
      _min: { startedAt: true },
    });

    return {
      totalBytes: Number(result._sum.fileSize ?? 0),
      recordingCount: result._count.id,
      oldestRecording: result._min.startedAt ?? null,
    };
  }

  /** Get per-camera storage breakdown for an organization. */
  async getPerCameraUsage(organizationId: string): Promise<CameraStorageUsage[]> {
    const cameras = await prisma.camera.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });

    const results: CameraStorageUsage[] = [];

    for (const camera of cameras) {
      const agg = await prisma.recording.aggregate({
        where: { cameraId: camera.id },
        _sum: { fileSize: true },
        _count: { id: true },
      });

      results.push({
        cameraId: camera.id,
        cameraName: camera.name,
        totalBytes: Number(agg._sum.fileSize ?? 0),
        recordingCount: agg._count.id,
      });
    }

    return results.sort((a, b) => b.totalBytes - a.totalBytes);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Delete recordings older than the retention period for an organization.
   * Removes segment files from disk and Recording entries from the database.
   * Returns the number of deleted recordings.
   */
  async cleanup(organizationId: string, retentionDays?: number): Promise<number> {
    const days = retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Find recordings older than the cutoff
    const oldRecordings = await prisma.recording.findMany({
      where: {
        organizationId,
        startedAt: { lt: cutoff },
        status: { not: 'recording' }, // Don't delete active recordings
      },
      select: {
        id: true,
        segmentDir: true,
      },
    });

    if (oldRecordings.length === 0) {
      return 0;
    }

    let deletedCount = 0;

    for (const recording of oldRecordings) {
      try {
        // Remove segment files from disk
        const fullDir = path.join(DATA_DIR, recording.segmentDir);
        await this.removeSegmentDir(fullDir);

        // Delete the database entry
        await prisma.recording.delete({
          where: { id: recording.id },
        });

        deletedCount++;
      } catch (err) {
        console.error(
          `[StorageManager] Error cleaning up recording ${recording.id}:`,
          err
        );
      }
    }

    console.log(
      `[StorageManager] Cleanup for org ${organizationId}: deleted ${deletedCount}/${oldRecordings.length} recordings (retention: ${days} days)`
    );

    return deletedCount;
  }

  /** Run cleanup for all organizations. */
  async cleanupAll(): Promise<void> {
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true },
    });

    console.log(
      `[StorageManager] Running cleanup for ${organizations.length} organization(s)...`
    );

    for (const org of organizations) {
      try {
        const deleted = await this.cleanup(org.id);
        if (deleted > 0) {
          console.log(
            `[StorageManager] Org "${org.name}": cleaned up ${deleted} recording(s)`
          );
        }
      } catch (err) {
        console.error(
          `[StorageManager] Error running cleanup for org "${org.name}":`,
          err
        );
      }
    }

    // Also clean up empty date/hour directories
    await this.cleanupEmptyDirs(RECORDINGS_DIR);

    console.log('[StorageManager] Cleanup complete');
  }

  // -----------------------------------------------------------------------
  // Disk usage
  // -----------------------------------------------------------------------

  /** Get disk usage for the partition containing the data directory. */
  getDiskUsage(): DiskUsage {
    try {
      const output = execSync('df -k .', {
        cwd: DATA_DIR,
        encoding: 'utf-8',
        timeout: 5_000,
      });

      // Parse df output:
      // Filesystem  1K-blocks  Used  Available  Use%  Mounted on
      const lines = output.trim().split('\n');
      if (lines.length < 2) {
        return { total: 0, used: 0, free: 0, percent: 0 };
      }

      const parts = lines[1].split(/\s+/);
      // parts: [filesystem, 1k-blocks, used, available, use%, mounted]
      const totalKB = parseInt(parts[1], 10) || 0;
      const usedKB = parseInt(parts[2], 10) || 0;
      const freeKB = parseInt(parts[3], 10) || 0;
      const percentStr = (parts[4] || '0').replace('%', '');
      const percent = parseInt(percentStr, 10) || 0;

      return {
        total: totalKB * 1024,
        used: usedKB * 1024,
        free: freeKB * 1024,
        percent,
      };
    } catch (err) {
      console.error('[StorageManager] Error getting disk usage:', err);
      return { total: 0, used: 0, free: 0, percent: 0 };
    }
  }

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  /** Convert bytes to human-readable format. */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const index = Math.min(i, units.length - 1);
    const value = bytes / Math.pow(k, index);

    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  // -----------------------------------------------------------------------
  // Auto-cleanup cron
  // -----------------------------------------------------------------------

  /** Start automatic periodic cleanup. */
  startAutoCleanup(intervalHours: number = 6): void {
    if (this.cleanupInterval) {
      console.log('[StorageManager] Auto-cleanup already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    console.log(
      `[StorageManager] Starting auto-cleanup every ${intervalHours} hour(s)`
    );

    // Run immediately on start
    void this.cleanupAll().catch((err) =>
      console.error('[StorageManager] Auto-cleanup error:', err)
    );

    // Then schedule periodic runs
    this.cleanupInterval = setInterval(() => {
      void this.cleanupAll().catch((err) =>
        console.error('[StorageManager] Auto-cleanup error:', err)
      );
    }, intervalMs);

    // Don't prevent Node.js from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /** Stop automatic periodic cleanup. */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[StorageManager] Auto-cleanup stopped');
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Recursively remove a segment directory and its contents. */
  private async removeSegmentDir(dir: string): Promise<void> {
    try {
      await stat(dir);
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      // Directory might not exist on disk (already deleted or never written)
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /**
   * Walk the recordings directory tree and remove empty directories
   * (leftover date/hour folders after segment deletion).
   */
  private async cleanupEmptyDirs(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          await this.cleanupEmptyDirs(fullPath);

          // After recursing, try to remove if now empty
          try {
            const remaining = await readdir(fullPath);
            if (remaining.length === 0) {
              await rm(fullPath, { recursive: false });
            }
          } catch {
            // Ignore errors on individual directory removal
          }
        }
      }
    } catch {
      // Ignore errors walking directories
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const storageManager = StorageManager.getInstance();

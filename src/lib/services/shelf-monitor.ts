/**
 * Singleton service for retail shelf fullness monitoring.
 * Calls the /detect-shelf-fullness endpoint and maintains
 * per-camera circular buffers of historical readings.
 * Emits 'shelf-alert' events when fullness drops below a configurable threshold.
 */

import { appEvents } from './event-emitter';

const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:8001';
const TIMEOUT_MS = 8_000;

// Maximum readings to keep per camera (circular buffer)
const MAX_READINGS_PER_CAMERA = 500;
// Default alert threshold (percent)
const DEFAULT_LOW_THRESHOLD = 30;

export interface ShelfROI {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShelfReading {
  cameraId: string;
  fullnessPercent: number;
  status: string;
  label: string;
  metrics: Record<string, unknown>;
  inferenceMs: number;
  timestamp: number;
}

export interface ShelfAlertPayload {
  cameraId: string;
  fullnessPercent: number;
  threshold: number;
  status: string;
  label: string;
  timestamp: number;
}

interface DetectShelfResponse {
  fullnessPercent: number;
  status: string;
  label: string;
  metrics: Record<string, unknown>;
  inferenceMs: number;
}

class ShelfMonitor {
  private static instance: ShelfMonitor;
  private available: boolean | null = null;
  private lastCheckAt = 0;
  private readonly checkIntervalMs = 30_000;

  /** Per-camera circular buffer of readings. */
  private readings = new Map<string, ShelfReading[]>();

  /** Configurable low-fullness alert threshold per camera (percent). */
  private thresholds = new Map<string, number>();

  /** Timestamp of last alert per camera to avoid spam. */
  private lastAlertTime = new Map<string, number>();
  private readonly alertCooldownMs = 5 * 60 * 1000; // 5 minutes

  static getInstance(): ShelfMonitor {
    if (!ShelfMonitor.instance) {
      ShelfMonitor.instance = new ShelfMonitor();
    }
    return ShelfMonitor.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Analyze a shelf image and return fullness data.
   * Optionally specify a region of interest (ROI) within the frame.
   * The reading is automatically stored and alert checks are performed.
   */
  async analyzeShelf(
    cameraId: string,
    imageBuffer: Buffer,
    roi?: ShelfROI
  ): Promise<ShelfReading | null> {
    const extraFields: Record<string, string> = {};
    if (roi) {
      extraFields.roi_x = String(roi.x);
      extraFields.roi_y = String(roi.y);
      extraFields.roi_w = String(roi.w);
      extraFields.roi_h = String(roi.h);
    }

    const response = await this.postImage('/detect-shelf-fullness', imageBuffer, extraFields);
    if (!response) return null;

    try {
      const data: DetectShelfResponse = await response.json();

      const reading: ShelfReading = {
        cameraId,
        fullnessPercent: data.fullnessPercent,
        status: data.status,
        label: data.label,
        metrics: data.metrics,
        inferenceMs: data.inferenceMs,
        timestamp: Date.now(),
      };

      this.storeReading(cameraId, reading);
      this.checkAlertThreshold(reading);

      console.log(
        `[ShelfMonitor] Camera ${cameraId}: ${data.fullnessPercent}% full (${data.status}) in ${data.inferenceMs}ms`
      );

      return reading;
    } catch (error) {
      console.warn('[ShelfMonitor] Parse error:', (error as Error).message);
      return null;
    }
  }

  /**
   * Get the latest shelf fullness reading for a camera.
   */
  getShelfStatus(cameraId: string): ShelfReading | null {
    const cameraReadings = this.readings.get(cameraId);
    if (!cameraReadings || cameraReadings.length === 0) return null;
    return cameraReadings[cameraReadings.length - 1];
  }

  /**
   * Get shelf fullness history for a camera over the last N hours.
   * Defaults to 24 hours.
   */
  getShelfHistory(cameraId: string, hours: number = 24): ShelfReading[] {
    const cameraReadings = this.readings.get(cameraId);
    if (!cameraReadings) return [];

    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return cameraReadings.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Set the low-fullness alert threshold for a camera (in percent).
   */
  setThreshold(cameraId: string, threshold: number): void {
    this.thresholds.set(cameraId, Math.max(0, Math.min(100, threshold)));
  }

  /**
   * Get the current alert threshold for a camera.
   */
  getThreshold(cameraId: string): number {
    return this.thresholds.get(cameraId) ?? DEFAULT_LOW_THRESHOLD;
  }

  /**
   * Clear all stored data for a camera.
   */
  clearCamera(cameraId: string): void {
    this.readings.delete(cameraId);
    this.lastAlertTime.delete(cameraId);
    this.thresholds.delete(cameraId);
  }

  /**
   * Clear all stored data.
   */
  clearAll(): void {
    this.readings.clear();
    this.lastAlertTime.clear();
    this.thresholds.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private storeReading(cameraId: string, reading: ShelfReading): void {
    let buffer = this.readings.get(cameraId);
    if (!buffer) {
      buffer = [];
      this.readings.set(cameraId, buffer);
    }

    buffer.push(reading);

    // Enforce circular buffer capacity
    if (buffer.length > MAX_READINGS_PER_CAMERA) {
      buffer.splice(0, buffer.length - MAX_READINGS_PER_CAMERA);
    }
  }

  private checkAlertThreshold(reading: ShelfReading): void {
    const threshold = this.getThreshold(reading.cameraId);

    if (reading.fullnessPercent < threshold) {
      const now = Date.now();
      const lastAlert = this.lastAlertTime.get(reading.cameraId) || 0;

      if (now - lastAlert < this.alertCooldownMs) return;
      this.lastAlertTime.set(reading.cameraId, now);

      const payload: ShelfAlertPayload = {
        cameraId: reading.cameraId,
        fullnessPercent: reading.fullnessPercent,
        threshold,
        status: reading.status,
        label: reading.label,
        timestamp: reading.timestamp,
      };

      appEvents.emit('shelf-alert', payload);

      console.log(
        `[ShelfMonitor] ALERT: Camera ${reading.cameraId} shelf fullness ${reading.fullnessPercent}% below threshold ${threshold}%`
      );
    }
  }

  private async postImage(
    endpoint: string,
    imageBuffer: Buffer,
    extraFields?: Record<string, string>
  ): Promise<Response | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer as unknown as BlobPart], { type: 'image/jpeg' });
      formData.append('image', blob, 'frame.jpg');
      if (extraFields) {
        for (const [k, v] of Object.entries(extraFields)) {
          formData.append(k, v);
        }
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(`${YOLO_SERVICE_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        console.warn(`[ShelfMonitor] ${endpoint} failed: HTTP ${response.status}`);
        return null;
      }
      return response;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn(`[ShelfMonitor] ${endpoint} timeout`);
      } else {
        console.warn(`[ShelfMonitor] ${endpoint} error:`, (error as Error).message);
      }
      this.available = false;
      this.lastCheckAt = Date.now();
      return null;
    }
  }

  private async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.available !== null && now - this.lastCheckAt < this.checkIntervalMs) {
      return this.available;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${YOLO_SERVICE_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.available = response.ok;
    } catch {
      this.available = false;
    }

    this.lastCheckAt = now;

    if (this.available) {
      console.log('[ShelfMonitor] Detection service available at', YOLO_SERVICE_URL);
    }

    return this.available;
  }
}

const globalForShelfMonitor = globalThis as unknown as {
  shelfMonitor: ShelfMonitor | undefined;
};

export const shelfMonitor =
  globalForShelfMonitor.shelfMonitor ?? ShelfMonitor.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForShelfMonitor.shelfMonitor = shelfMonitor;

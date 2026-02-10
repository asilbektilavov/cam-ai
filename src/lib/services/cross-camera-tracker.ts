/**
 * Singleton service for cross-camera person tracking.
 * Uses feature extraction and matching endpoints to identify the same person
 * across multiple camera feeds.
 */

import { appEvents, CameraEvent } from './event-emitter';

const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:8001';
const TIMEOUT_MS = 10_000;

// How long to keep features in the in-memory store (5 minutes)
const FEATURE_TTL_MS = 5 * 60 * 1000;
// Maximum number of feature snapshots to keep per camera
const MAX_FEATURES_PER_CAMERA = 100;
// Default cosine similarity threshold for matching
const DEFAULT_MATCH_THRESHOLD = 0.6;

export interface PersonFeatureSnapshot {
  personId: string;
  cameraId: string;
  features: number[];
  featureDim: number;
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: number;
}

export interface TrackingEntry {
  personId: string;
  cameraId: string;
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: number;
}

export interface MatchResult {
  indexA: number;
  indexB: number;
  similarity: number;
}

interface ExtractFeaturesResponse {
  persons: Array<{
    bbox: { x: number; y: number; w: number; h: number };
    features: number[];
    featureDim: number;
  }>;
  cameraId: string;
  personCount: number;
  inferenceMs: number;
}

interface MatchPersonsResponse {
  matches: MatchResult[];
  totalA: number;
  totalB: number;
  matchCount: number;
  threshold: number;
  inferenceMs: number;
}

class CrossCameraTracker {
  private static instance: CrossCameraTracker;
  private available: boolean | null = null;
  private lastCheckAt = 0;
  private readonly checkIntervalMs = 30_000;

  /**
   * In-memory store of recent feature snapshots per camera.
   * Key: cameraId, Value: array of snapshots (most recent last).
   */
  private featureStore = new Map<string, PersonFeatureSnapshot[]>();

  /**
   * Global tracking history: personId -> trajectory entries.
   * A personId is assigned when a person is first seen and carried forward
   * when matched across cameras.
   */
  private trackingHistory = new Map<string, TrackingEntry[]>();

  /** Auto-incrementing counter for generating person IDs. */
  private nextPersonId = 1;

  static getInstance(): CrossCameraTracker {
    if (!CrossCameraTracker.instance) {
      CrossCameraTracker.instance = new CrossCameraTracker();
    }
    return CrossCameraTracker.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Extract person features from an image captured by a specific camera.
   * Stores the features in the in-memory store for later matching.
   */
  async extractFeatures(
    cameraId: string,
    imageBuffer: Buffer
  ): Promise<PersonFeatureSnapshot[]> {
    const response = await this.postImage('/extract-features', imageBuffer, {
      camera_id: cameraId,
    });
    if (!response) return [];

    try {
      const data: ExtractFeaturesResponse = await response.json();
      if (data.personCount === 0) return [];

      const now = Date.now();
      const snapshots: PersonFeatureSnapshot[] = data.persons.map((p) => ({
        personId: this.generatePersonId(),
        cameraId,
        features: p.features,
        featureDim: p.featureDim,
        bbox: p.bbox,
        timestamp: now,
      }));

      // Store in per-camera feature store
      this.storeFeatures(cameraId, snapshots);

      console.log(
        `[CrossCameraTracker] Extracted ${snapshots.length} person features from camera ${cameraId} in ${data.inferenceMs}ms`
      );

      return snapshots;
    } catch (error) {
      console.warn('[CrossCameraTracker] Feature extraction parse error:', (error as Error).message);
      return [];
    }
  }

  /**
   * Match two sets of feature vectors using the detection service.
   */
  async matchPersons(
    featuresA: number[][],
    featuresB: number[][],
    threshold: number = DEFAULT_MATCH_THRESHOLD
  ): Promise<MatchResult[]> {
    if (featuresA.length === 0 || featuresB.length === 0) return [];

    if (!(await this.isAvailable())) return [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${YOLO_SERVICE_URL}/match-persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features_a: featuresA,
          features_b: featuresB,
          threshold,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[CrossCameraTracker] Match failed: HTTP ${response.status}`);
        return [];
      }

      const data: MatchPersonsResponse = await response.json();
      console.log(
        `[CrossCameraTracker] Matched ${data.matchCount}/${data.totalA} persons (threshold=${data.threshold}) in ${data.inferenceMs}ms`
      );
      return data.matches;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn('[CrossCameraTracker] Match timeout');
      } else {
        console.warn('[CrossCameraTracker] Match error:', (error as Error).message);
      }
      this.available = false;
      this.lastCheckAt = Date.now();
      return [];
    }
  }

  /**
   * Track a person across multiple cameras.
   * Extracts features from each specified camera's recent store and matches
   * against the given person features.
   * Returns a list of cameras where the person was seen with timestamps.
   */
  async trackPerson(
    personFeatures: number[],
    cameras: string[]
  ): Promise<TrackingEntry[]> {
    const results: TrackingEntry[] = [];

    for (const cameraId of cameras) {
      const cameraSnapshots = this.getRecentFeatures(cameraId);
      if (cameraSnapshots.length === 0) continue;

      const cameraFeatureVectors = cameraSnapshots.map((s) => s.features);
      const matches = await this.matchPersons(
        [personFeatures],
        cameraFeatureVectors
      );

      for (const match of matches) {
        const snapshot = cameraSnapshots[match.indexB];
        results.push({
          personId: snapshot.personId,
          cameraId: snapshot.cameraId,
          bbox: snapshot.bbox,
          timestamp: snapshot.timestamp,
        });
      }
    }

    // Sort by timestamp (earliest first)
    results.sort((a, b) => a.timestamp - b.timestamp);

    // Emit tracking event if person found on multiple cameras
    if (results.length > 1) {
      const cameraIds = Array.from(new Set(results.map((r) => r.cameraId)));
      if (cameraIds.length > 1) {
        const event: CameraEvent = {
          type: 'person_sighting',
          cameraId: results[0].cameraId,
          organizationId: '',
          branchId: '',
          data: {
            personId: results[0].personId,
            cameras: cameraIds,
            sightings: results.length,
          },
        };
        appEvents.emit('camera-event', event);
      }
    }

    return results;
  }

  /**
   * Get the full tracking history for a person ID.
   */
  getTrackingHistory(personId: string): TrackingEntry[] {
    return this.trackingHistory.get(personId) || [];
  }

  /**
   * Get recent feature snapshots for a camera.
   */
  getRecentFeatures(cameraId: string): PersonFeatureSnapshot[] {
    this.evictStale(cameraId);
    return this.featureStore.get(cameraId) || [];
  }

  /**
   * Clear all stored data for a camera.
   */
  clearCamera(cameraId: string): void {
    this.featureStore.delete(cameraId);
  }

  /**
   * Clear all tracking data.
   */
  clearAll(): void {
    this.featureStore.clear();
    this.trackingHistory.clear();
    this.nextPersonId = 1;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private generatePersonId(): string {
    return `person_${Date.now()}_${this.nextPersonId++}`;
  }

  private storeFeatures(cameraId: string, snapshots: PersonFeatureSnapshot[]): void {
    let store = this.featureStore.get(cameraId);
    if (!store) {
      store = [];
      this.featureStore.set(cameraId, store);
    }

    store.push(...snapshots);

    // Evict stale entries
    this.evictStale(cameraId);

    // Enforce max capacity
    if (store.length > MAX_FEATURES_PER_CAMERA) {
      store.splice(0, store.length - MAX_FEATURES_PER_CAMERA);
    }

    // Record in tracking history
    for (const snapshot of snapshots) {
      const entry: TrackingEntry = {
        personId: snapshot.personId,
        cameraId: snapshot.cameraId,
        bbox: snapshot.bbox,
        timestamp: snapshot.timestamp,
      };
      let history = this.trackingHistory.get(snapshot.personId);
      if (!history) {
        history = [];
        this.trackingHistory.set(snapshot.personId, history);
      }
      history.push(entry);
    }
  }

  private evictStale(cameraId: string): void {
    const store = this.featureStore.get(cameraId);
    if (!store) return;

    const cutoff = Date.now() - FEATURE_TTL_MS;
    const firstValid = store.findIndex((s) => s.timestamp >= cutoff);

    if (firstValid > 0) {
      store.splice(0, firstValid);
    } else if (firstValid === -1) {
      // All entries are stale
      store.length = 0;
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
        console.warn(`[CrossCameraTracker] ${endpoint} failed: HTTP ${response.status}`);
        return null;
      }
      return response;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn(`[CrossCameraTracker] ${endpoint} timeout`);
      } else {
        console.warn(`[CrossCameraTracker] ${endpoint} error:`, (error as Error).message);
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
      console.log('[CrossCameraTracker] Detection service available at', YOLO_SERVICE_URL);
    }

    return this.available;
  }
}

const globalForTracker = globalThis as unknown as {
  crossCameraTracker: CrossCameraTracker | undefined;
};

export const crossCameraTracker =
  globalForTracker.crossCameraTracker ?? CrossCameraTracker.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForTracker.crossCameraTracker = crossCameraTracker;

/**
 * Singleton service for audio analytics.
 * Sends audio buffers to the /analyze-audio endpoint and maintains
 * an in-memory store of recent audio events per camera (last 30 minutes).
 * Emits 'audio-alert' events when audio events are detected.
 */

import { appEvents } from './event-emitter';

const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:8001';
const TIMEOUT_MS = 10_000;

// How long to keep audio events in-memory (30 minutes)
const EVENT_TTL_MS = 30 * 60 * 1000;
// Default sample rate if not specified
const DEFAULT_SAMPLE_RATE = 16000;
// Maximum events to keep per camera
const MAX_EVENTS_PER_CAMERA = 200;

export interface AudioEvent {
  type: string;
  label: string;
  confidence: number;
  startMs: number;
  endMs: number;
}

export interface AudioAnalysisResult {
  cameraId: string;
  events: AudioEvent[];
  rmsDb: number;
  peakDb: number;
  spectralCentroid: number;
  bandEnergy: Record<string, number>;
  inferenceMs: number;
  timestamp: number;
}

export interface AudioAlertPayload {
  cameraId: string;
  event: AudioEvent;
  rmsDb: number;
  peakDb: number;
  timestamp: number;
}

interface AnalyzeAudioResponse {
  events: AudioEvent[];
  rmsDb: number;
  peakDb: number;
  spectralCentroid: number;
  bandEnergy: Record<string, number>;
  inferenceMs: number;
}

class AudioAnalyzer {
  private static instance: AudioAnalyzer;
  private available: boolean | null = null;
  private lastCheckAt = 0;
  private readonly checkIntervalMs = 30_000;

  /** Per-camera store of recent audio analysis results. */
  private recentResults = new Map<string, AudioAnalysisResult[]>();

  static getInstance(): AudioAnalyzer {
    if (!AudioAnalyzer.instance) {
      AudioAnalyzer.instance = new AudioAnalyzer();
    }
    return AudioAnalyzer.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Analyze an audio buffer from a specific camera.
   * Returns analysis results including detected events and audio metrics.
   */
  async analyzeAudio(
    cameraId: string,
    audioBuffer: Buffer,
    sampleRate: number = DEFAULT_SAMPLE_RATE
  ): Promise<AudioAnalysisResult | null> {
    if (!(await this.isAvailable())) return null;

    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer as unknown as BlobPart], { type: 'audio/wav' });
      formData.append('audio', blob, 'audio.wav');
      formData.append('sample_rate', String(sampleRate));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${YOLO_SERVICE_URL}/analyze-audio`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[AudioAnalyzer] Analysis failed: HTTP ${response.status}`);
        return null;
      }

      const data: AnalyzeAudioResponse = await response.json();
      const now = Date.now();

      const result: AudioAnalysisResult = {
        cameraId,
        events: data.events,
        rmsDb: data.rmsDb,
        peakDb: data.peakDb,
        spectralCentroid: data.spectralCentroid,
        bandEnergy: data.bandEnergy,
        inferenceMs: data.inferenceMs,
        timestamp: now,
      };

      // Store the result
      this.storeResult(cameraId, result);

      // Emit alerts for detected events
      for (const event of data.events) {
        const alertPayload: AudioAlertPayload = {
          cameraId,
          event,
          rmsDb: data.rmsDb,
          peakDb: data.peakDb,
          timestamp: now,
        };
        appEvents.emit('audio-alert', alertPayload);
      }

      if (data.events.length > 0) {
        console.log(
          `[AudioAnalyzer] Camera ${cameraId}: ${data.events.length} events detected (${data.events.map((e) => e.type).join(', ')}) in ${data.inferenceMs}ms | RMS=${data.rmsDb.toFixed(1)}dB Peak=${data.peakDb.toFixed(1)}dB`
        );
      }

      return result;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn('[AudioAnalyzer] Analysis timeout');
      } else {
        console.warn('[AudioAnalyzer] Analysis error:', (error as Error).message);
      }
      this.available = false;
      this.lastCheckAt = Date.now();
      return null;
    }
  }

  /**
   * Get recent audio events for a camera within the retention window (30 minutes).
   */
  getRecentEvents(cameraId: string): AudioAnalysisResult[] {
    this.evictStale(cameraId);
    return this.recentResults.get(cameraId) || [];
  }

  /**
   * Get just the audio events (flattened) for a camera.
   */
  getRecentEventsList(cameraId: string): Array<AudioEvent & { cameraId: string; timestamp: number }> {
    const results = this.getRecentEvents(cameraId);
    const events: Array<AudioEvent & { cameraId: string; timestamp: number }> = [];

    for (const result of results) {
      for (const event of result.events) {
        events.push({
          ...event,
          cameraId: result.cameraId,
          timestamp: result.timestamp,
        });
      }
    }

    return events;
  }

  /**
   * Clear all stored data for a camera.
   */
  clearCamera(cameraId: string): void {
    this.recentResults.delete(cameraId);
  }

  /**
   * Clear all stored data.
   */
  clearAll(): void {
    this.recentResults.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private storeResult(cameraId: string, result: AudioAnalysisResult): void {
    let store = this.recentResults.get(cameraId);
    if (!store) {
      store = [];
      this.recentResults.set(cameraId, store);
    }

    store.push(result);

    // Evict stale entries
    this.evictStale(cameraId);

    // Enforce max capacity
    if (store.length > MAX_EVENTS_PER_CAMERA) {
      store.splice(0, store.length - MAX_EVENTS_PER_CAMERA);
    }
  }

  private evictStale(cameraId: string): void {
    const store = this.recentResults.get(cameraId);
    if (!store) return;

    const cutoff = Date.now() - EVENT_TTL_MS;
    const firstValid = store.findIndex((r) => r.timestamp >= cutoff);

    if (firstValid > 0) {
      store.splice(0, firstValid);
    } else if (firstValid === -1 && store.length > 0) {
      store.length = 0;
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
      console.log('[AudioAnalyzer] Detection service available at', YOLO_SERVICE_URL);
    }

    return this.available;
  }
}

const globalForAudioAnalyzer = globalThis as unknown as {
  audioAnalyzer: AudioAnalyzer | undefined;
};

export const audioAnalyzer =
  globalForAudioAnalyzer.audioAnalyzer ?? AudioAnalyzer.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForAudioAnalyzer.audioAnalyzer = audioAnalyzer;

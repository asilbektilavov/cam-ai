/**
 * Singleton HTTP client for the Python YOLO detection service.
 * Sends JPEG frames and receives bounding box detections.
 */

export interface YoloDetection {
  type: string;       // person, car, bus, truck, bicycle, motorcycle, cat, dog, object
  label: string;      // Russian label
  confidence: number; // 0-1
  bbox: {
    x: number; // normalized 0-1
    y: number;
    w: number;
    h: number;
  };
  classId: number;
  color: string;      // hex color
}

interface DetectResponse {
  detections: YoloDetection[];
  inferenceMs: number;
}

const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:8001';
const TIMEOUT_MS = 5000;

class YoloDetector {
  private static instance: YoloDetector;
  private available: boolean | null = null;
  private lastCheckAt = 0;
  private readonly checkIntervalMs = 30_000; // re-check availability every 30s

  static getInstance(): YoloDetector {
    if (!YoloDetector.instance) {
      YoloDetector.instance = new YoloDetector();
    }
    return YoloDetector.instance;
  }

  /**
   * Send an image buffer to the YOLO service and get detections.
   * Returns empty array if service is unavailable (graceful degradation).
   */
  async detect(imageBuffer: Buffer): Promise<YoloDetection[]> {
    if (!(await this.isAvailable())) {
      return [];
    }

    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer as unknown as BlobPart], { type: 'image/jpeg' });
      formData.append('image', blob, 'frame.jpg');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${YOLO_SERVICE_URL}/detect`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[YOLO] Detection failed: HTTP ${response.status}`);
        return [];
      }

      const data: DetectResponse = await response.json();
      if (data.detections.length > 0) {
        console.log(`[YOLO] ${data.detections.length} detections in ${data.inferenceMs}ms`);
      }
      return data.detections;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn('[YOLO] Detection timeout');
      } else {
        console.warn('[YOLO] Detection error:', (error as Error).message);
      }
      this.available = false;
      this.lastCheckAt = Date.now();
      return [];
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
      console.log('[YOLO] Service available at', YOLO_SERVICE_URL);
    }

    return this.available;
  }
}

const globalForYolo = globalThis as unknown as {
  yoloDetector: YoloDetector | undefined;
};

export const yoloDetector =
  globalForYolo.yoloDetector ?? YoloDetector.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForYolo.yoloDetector = yoloDetector;

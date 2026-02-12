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

export interface FireSmokeResult {
  fireDetected: boolean;
  fireConfidence: number;
  fireRegions: Array<{ bbox: { x: number; y: number; w: number; h: number }; area: number }>;
  smokeDetected: boolean;
  smokeConfidence: number;
  smokeRegions: Array<{ bbox: { x: number; y: number; w: number; h: number }; area: number }>;
  inferenceMs: number;
}

export interface PlateResult {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
}

interface PlatesResponse {
  plates: PlateResult[];
  vehicleCount: number;
  inferenceMs: number;
}

export interface BehaviorResult {
  personIndex: number;
  behavior: string;
  label: string;
  confidence: number;
  motionMagnitude: number;
  bbox: { x: number; y: number; w: number; h: number };
  persons?: number[];
}

export interface SpeedResult {
  personIndex: number;
  speedMps: number;
  speedKmh: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface CrowdDensityResult {
  personCount: number;
  density: number;
  level: string;
  label: string;
  fovAreaM2: number;
}

interface BehaviorResponse {
  behaviors: BehaviorResult[];
  speeds: SpeedResult[];
  crowdDensity: CrowdDensityResult;
  personCount: number;
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

  private async postImage(endpoint: string, imageBuffer: Buffer, extraFields?: Record<string, string>): Promise<Response | null> {
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
      if (!response.ok) return null;
      return response;
    } catch {
      this.available = false;
      this.lastCheckAt = Date.now();
      return null;
    }
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

  /**
   * Detect fire and smoke using OpenCV HSV analysis.
   */
  async detectFire(imageBuffer: Buffer): Promise<FireSmokeResult | null> {
    const response = await this.postImage('/detect-fire', imageBuffer);
    if (!response) return null;
    try {
      return await response.json() as FireSmokeResult;
    } catch {
      return null;
    }
  }

  /**
   * Detect license plates using YOLO + EasyOCR.
   */
  async detectPlates(imageBuffer: Buffer): Promise<PlatesResponse | null> {
    const response = await this.postImage('/detect-plates', imageBuffer);
    if (!response) return null;
    try {
      return await response.json() as PlatesResponse;
    } catch {
      return null;
    }
  }

  /**
   * Analyze behavior, speed, and crowd density.
   */
  async analyzeBehavior(imageBuffer: Buffer, cameraId: string): Promise<BehaviorResponse | null> {
    const response = await this.postImage('/analyze-behavior', imageBuffer, {
      camera_id: cameraId,
      pixels_per_meter: '50.0',
      fov_area_m2: '50.0',
    });
    if (!response) return null;
    try {
      return await response.json() as BehaviorResponse;
    } catch {
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

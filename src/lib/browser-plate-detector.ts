/**
 * Browser-side license plate detection via ONNX Runtime Web + YOLOv8n.
 * Shares onnxruntime-web with browser-yolo.ts — avoids double WASM init.
 * ~12MB model, 320x320 input, 1 class (license_plate).
 */

import type { Detection } from '@/components/detection-overlay';

const MODEL_URL = '/models/plate-detector.onnx';
const INPUT_SIZE = 320;
const CONF_THRESHOLD = 0.4;
const IOU_THRESHOLD = 0.4;

type OrtSession = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>;
  release(): void;
};

type OrtModule = {
  InferenceSession: {
    create(path: string, options?: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  env: {
    wasm: { wasmPaths: string };
  };
};

async function getOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-web');
  return ort as unknown as OrtModule;
}

class BrowserPlateDetector {
  private session: OrtSession | null = null;
  private loadPromise: Promise<void> | null = null;
  private _backend: string | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private float32Buf: Float32Array | null = null;

  get isReady(): boolean {
    return this.session !== null;
  }

  get backend(): string | null {
    return this._backend;
  }

  async init(): Promise<void> {
    if (this.session) return;
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = this._init();
    await this.loadPromise;
  }

  private async _init(): Promise<void> {
    const ort = await getOrt();
    if (!ort.env.wasm.wasmPaths) {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/';
    }

    const backends: Array<{ name: string; ep: string }> = [
      { name: 'webgpu', ep: 'webgpu' },
      { name: 'wasm', ep: 'wasm' },
    ];

    for (const { name, ep } of backends) {
      try {
        console.log(`[BrowserPlate] Trying ${name}...`);
        this.session = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: [ep],
        });
        this._backend = name;
        console.log(`[BrowserPlate] Plate detector ready (${name})`);
        return;
      } catch (e) {
        console.warn(`[BrowserPlate] ${name} failed:`, e);
        this.session = null;
      }
    }

    throw new Error('No working ONNX backend for plate detection');
  }

  async detect(source: HTMLVideoElement | HTMLImageElement): Promise<Detection[]> {
    if (!this.session) return [];

    const ort = await getOrt();
    const vw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const vh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (vw === 0 || vh === 0) return [];

    if (!this.canvas || this.canvas.width !== INPUT_SIZE) {
      this.canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    }

    const ctx = this.ctx!;

    // Letterbox: preserve aspect ratio
    const scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
    const nw = Math.round(vw * scale);
    const nh = Math.round(vh * scale);
    const padX = (INPUT_SIZE - nw) / 2;
    const padY = (INPUT_SIZE - nh) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(source, padX, padY, nw, nh);

    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const pixels = imageData.data;

    // RGBA -> CHW float32, normalized [0, 1]
    const area = INPUT_SIZE * INPUT_SIZE;
    const inputSize = 3 * area;
    if (!this.float32Buf || this.float32Buf.length !== inputSize) {
      this.float32Buf = new Float32Array(inputSize);
    }
    const float32Data = this.float32Buf;

    for (let i = 0; i < area; i++) {
      const ri = i * 4;
      float32Data[i] = pixels[ri] / 255;
      float32Data[area + i] = pixels[ri + 1] / 255;
      float32Data[2 * area + i] = pixels[ri + 2] / 255;
    }

    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await this.session.run({ images: inputTensor });

    // YOLOv8 output: [1, 5, 2100] — 5 = 4 bbox (cx,cy,w,h) + 1 class (license_plate)
    const output = results[Object.keys(results)[0]];
    const data = output.data;
    const numDetections = output.dims[2]; // 2100

    const detections: Detection[] = [];

    for (let i = 0; i < numDetections; i++) {
      const conf = data[4 * numDetections + i]; // single class score
      if (conf < CONF_THRESHOLD) continue;

      const cx = data[0 * numDetections + i];
      const cy = data[1 * numDetections + i];
      const bw = data[2 * numDetections + i];
      const bh = data[3 * numDetections + i];

      // Letterbox -> normalized 0-1
      const x1 = (cx - bw / 2 - padX) / nw;
      const y1 = (cy - bh / 2 - padY) / nh;
      const w = bw / nw;
      const h = bh / nh;

      if (x1 + w < 0 || y1 + h < 0 || x1 > 1 || y1 > 1) continue;

      detections.push({
        type: 'plate',
        label: 'Номер',
        confidence: conf,
        bbox: {
          x: Math.max(0, x1),
          y: Math.max(0, y1),
          w: Math.min(w, 1 - Math.max(0, x1)),
          h: Math.min(h, 1 - Math.max(0, y1)),
        },
        classId: 0,
        color: '#F59E0B', // amber for plates
      });
    }

    return this.nms(detections);
  }

  private nms(detections: Detection[]): Detection[] {
    detections.sort((a, b) => b.confidence - a.confidence);
    const kept: Detection[] = [];

    for (const det of detections) {
      const dominated = kept.some(k => {
        const x1 = Math.max(k.bbox.x, det.bbox.x);
        const y1 = Math.max(k.bbox.y, det.bbox.y);
        const x2 = Math.min(k.bbox.x + k.bbox.w, det.bbox.x + det.bbox.w);
        const y2 = Math.min(k.bbox.y + k.bbox.h, det.bbox.y + det.bbox.h);
        const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const union = k.bbox.w * k.bbox.h + det.bbox.w * det.bbox.h - inter;
        return union > 0 && inter / union > IOU_THRESHOLD;
      });
      if (!dominated) kept.push(det);
    }

    return kept;
  }
}

const globalKey = '__browserPlateDetector_v1';
const g = globalThis as unknown as Record<string, BrowserPlateDetector | undefined>;

export const browserPlateDetector: BrowserPlateDetector = g[globalKey] ?? new BrowserPlateDetector();
if (typeof window !== 'undefined') {
  g[globalKey] = browserPlateDetector;
}

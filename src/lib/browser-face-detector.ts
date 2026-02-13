/**
 * Browser-side face detection via ONNX Runtime Web + UltraFace model.
 * Shares onnxruntime-web with browser-yolo.ts — avoids double WASM init.
 * ~1.2MB model, 320x240 input.
 */

import type { Detection } from '@/components/detection-overlay';

const MODEL_URL = '/models/face/ultraface-320.onnx';
const INPUT_W = 320;
const INPUT_H = 240;
const CONF_THRESHOLD = 0.7;
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
  // ES module cache ensures same instance as browser-yolo.ts
  const ort = await import('onnxruntime-web');
  return ort as unknown as OrtModule;
}

class BrowserFaceDetector {
  private session: OrtSession | null = null;
  private loadPromise: Promise<void> | null = null;
  private _backend: string | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

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
    // WASM paths may already be set by browser-yolo — set only if not yet configured
    if (!ort.env.wasm.wasmPaths) {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/';
    }

    // Strategy: try creating session without specific EP first (uses already-initialized backend),
    // then try explicit EPs as fallback
    const attempts: Array<{ label: string; opts?: Record<string, unknown> }> = [
      { label: 'default (auto)', opts: undefined },
      { label: 'wasm', opts: { executionProviders: ['wasm'] } },
      { label: 'webgpu', opts: { executionProviders: ['webgpu'] } },
    ];

    for (const { label, opts } of attempts) {
      try {
        console.log(`[BrowserFace] Trying ${label}...`);
        this.session = await ort.InferenceSession.create(MODEL_URL, opts);

        // Verify inference works (WebGPU can load but fail at runtime)
        const testInput = new Float32Array(3 * INPUT_H * INPUT_W);
        const testTensor = new ort.Tensor('float32', testInput, [1, 3, INPUT_H, INPUT_W]);
        await this.session.run({ input: testTensor });

        this._backend = label;
        console.log(`[BrowserFace] UltraFace ready (${label})`);
        return;
      } catch (e) {
        console.warn(`[BrowserFace] ${label} failed:`, e);
        this.session = null;
      }
    }

    throw new Error('No working ONNX backend for face detection');
  }

  async detect(source: HTMLVideoElement | HTMLImageElement): Promise<Detection[]> {
    if (!this.session) return [];

    const ort = await getOrt();
    const vw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const vh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (vw === 0 || vh === 0) return [];

    // Reuse offscreen canvas
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(INPUT_W, INPUT_H);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    }

    const ctx = this.ctx!;
    ctx.drawImage(source, 0, 0, INPUT_W, INPUT_H);

    const imageData = ctx.getImageData(0, 0, INPUT_W, INPUT_H);
    const pixels = imageData.data;

    // RGBA → CHW float32, normalize: (pixel - 127) / 128
    const inputSize = 3 * INPUT_W * INPUT_H;
    const float32Data = new Float32Array(inputSize);
    const area = INPUT_W * INPUT_H;

    for (let i = 0; i < area; i++) {
      const ri = i * 4;
      float32Data[i] = (pixels[ri] - 127) / 128;
      float32Data[area + i] = (pixels[ri + 1] - 127) / 128;
      float32Data[2 * area + i] = (pixels[ri + 2] - 127) / 128;
    }

    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, INPUT_H, INPUT_W]);
    const results = await this.session.run({ input: inputTensor });

    const scores = results['scores'];
    const boxes = results['boxes'];
    if (!scores || !boxes) return [];

    const numBoxes = scores.dims[1];
    const detections: Detection[] = [];

    for (let i = 0; i < numBoxes; i++) {
      const faceScore = scores.data[i * 2 + 1];
      if (faceScore < CONF_THRESHOLD) continue;

      const x1 = boxes.data[i * 4 + 0];
      const y1 = boxes.data[i * 4 + 1];
      const x2 = boxes.data[i * 4 + 2];
      const y2 = boxes.data[i * 4 + 3];

      detections.push({
        type: 'face',
        label: 'Лицо',
        confidence: faceScore,
        bbox: {
          x: Math.max(0, x1),
          y: Math.max(0, y1),
          w: Math.min(1, x2) - Math.max(0, x1),
          h: Math.min(1, y2) - Math.max(0, y1),
        },
        classId: -1,
        color: '#3B82F6',
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

const globalKey = '__browserFaceDetector_v4';
const g = globalThis as unknown as Record<string, BrowserFaceDetector | undefined>;

export const browserFaceDetector: BrowserFaceDetector = g[globalKey] ?? new BrowserFaceDetector();
if (typeof window !== 'undefined') {
  g[globalKey] = browserFaceDetector;
}

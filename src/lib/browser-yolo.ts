/**
 * Browser-side YOLOv8n inference via ONNX Runtime Web.
 * Singleton — loads model once, reuses across detections.
 * Backend priority: WebGPU → WASM.
 */

import type { Detection } from '@/components/detection-overlay';

// COCO 80-class names → Russian labels + colors
// Categories: person (#3B82F6), vehicle (#22C55E), animal (#8B5CF6), other (#6B7280)
const COCO_CLASSES: Record<number, { type: string; label: string; color: string }> = {
  // Люди
  0:  { type: 'person',       label: 'Человек',       color: '#3B82F6' },
  // Транспорт
  1:  { type: 'bicycle',      label: 'Велосипед',     color: '#22C55E' },
  2:  { type: 'car',          label: 'Автомобиль',    color: '#22C55E' },
  3:  { type: 'motorcycle',   label: 'Мотоцикл',      color: '#22C55E' },
  4:  { type: 'airplane',     label: 'Самолёт',       color: '#22C55E' },
  5:  { type: 'bus',          label: 'Автобус',        color: '#22C55E' },
  6:  { type: 'train',        label: 'Поезд',         color: '#22C55E' },
  7:  { type: 'truck',        label: 'Грузовик',      color: '#22C55E' },
  8:  { type: 'boat',         label: 'Лодка',         color: '#22C55E' },
  // Животные
  14: { type: 'bird',         label: 'Птица',         color: '#8B5CF6' },
  15: { type: 'cat',          label: 'Кошка',         color: '#8B5CF6' },
  16: { type: 'dog',          label: 'Собака',        color: '#8B5CF6' },
  17: { type: 'horse',        label: 'Лошадь',        color: '#8B5CF6' },
  18: { type: 'sheep',        label: 'Овца',          color: '#8B5CF6' },
  19: { type: 'cow',          label: 'Корова',        color: '#8B5CF6' },
  20: { type: 'elephant',     label: 'Слон',          color: '#8B5CF6' },
  21: { type: 'bear',         label: 'Медведь',       color: '#8B5CF6' },
  // Прочее — предметы/объекты
  9:  { type: 'traffic_light', label: 'Светофор',     color: '#6B7280' },
  10: { type: 'fire_hydrant', label: 'Гидрант',       color: '#6B7280' },
  11: { type: 'stop_sign',    label: 'Знак стоп',     color: '#6B7280' },
  13: { type: 'bench',        label: 'Скамейка',      color: '#6B7280' },
  24: { type: 'backpack',     label: 'Рюкзак',        color: '#6B7280' },
  25: { type: 'umbrella',     label: 'Зонт',          color: '#6B7280' },
  26: { type: 'handbag',      label: 'Сумка',         color: '#6B7280' },
  28: { type: 'suitcase',     label: 'Чемодан',       color: '#6B7280' },
  39: { type: 'bottle',       label: 'Бутылка',       color: '#6B7280' },
  41: { type: 'cup',          label: 'Чашка',         color: '#6B7280' },
  43: { type: 'knife',        label: 'Нож',           color: '#EF4444' },
  45: { type: 'bowl',         label: 'Миска',         color: '#6B7280' },
  56: { type: 'chair',        label: 'Стул',          color: '#6B7280' },
  57: { type: 'couch',        label: 'Диван',         color: '#6B7280' },
  58: { type: 'potted_plant', label: 'Растение',      color: '#6B7280' },
  60: { type: 'dining_table', label: 'Стол',          color: '#6B7280' },
  62: { type: 'tv',           label: 'Монитор',       color: '#6B7280' },
  63: { type: 'laptop',       label: 'Ноутбук',       color: '#6B7280' },
  64: { type: 'mouse',        label: 'Мышь',          color: '#6B7280' },
  66: { type: 'keyboard',     label: 'Клавиатура',    color: '#6B7280' },
  67: { type: 'cell_phone',   label: 'Телефон',       color: '#6B7280' },
  73: { type: 'book',         label: 'Книга',         color: '#6B7280' },
  74: { type: 'clock',        label: 'Часы',          color: '#6B7280' },
  75: { type: 'vase',         label: 'Ваза',          color: '#6B7280' },
  76: { type: 'scissors',     label: 'Ножницы',       color: '#6B7280' },
};

// All COCO class IDs we care about
const ENABLED_CLASS_IDS = new Set(Object.keys(COCO_CLASSES).map(Number));

const MODEL_URL = '/models/yolov8n.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.5;

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

let ortModule: OrtModule | null = null;

async function getOrt(): Promise<OrtModule> {
  if (ortModule) return ortModule;
  // Dynamic import — only loaded when needed
  const ort = await import('onnxruntime-web');
  ortModule = ort as unknown as OrtModule;
  return ortModule;
}

class BrowserYolo {
  private session: OrtSession | null = null;
  private loading = false;
  private loadPromise: Promise<void> | null = null;
  private _backend: 'webgpu' | 'wasm' | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  // Pre-allocated buffer reused across detect() calls (~4.9MB, allocated once)
  private float32Buf: Float32Array | null = null;

  get backend(): string | null {
    return this._backend;
  }

  get isReady(): boolean {
    return this.session !== null;
  }

  async init(): Promise<void> {
    if (this.session) return;
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loading = true;
    this.loadPromise = this._init();
    await this.loadPromise;
    this.loading = false;
  }

  private async _init(): Promise<void> {
    const ort = await getOrt();

    // Set WASM paths
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/';

    // Try WebGPU first, fall back to WASM
    const backends: Array<{ name: 'webgpu' | 'wasm'; ep: string }> = [
      { name: 'webgpu', ep: 'webgpu' },
      { name: 'wasm', ep: 'wasm' },
    ];

    for (const { name, ep } of backends) {
      try {
        console.log(`[BrowserYOLO] Trying ${name} backend...`);
        this.session = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: [ep],
        });
        this._backend = name;
        console.log(`[BrowserYOLO] Model loaded (${name})`);
        return;
      } catch (e) {
        console.warn(`[BrowserYOLO] ${name} failed:`, e);
      }
    }

    throw new Error('No ONNX backend available');
  }

  /**
   * Run detection on a video/image frame.
   * Accepts HTMLVideoElement (WebRTC) or HTMLImageElement (MJPEG poster).
   * @param source Frame source element
   * @param enabledClasses Optional set of type strings to filter (e.g. 'person', 'car')
   * @returns Detection[] in normalized 0-1 coordinates
   */
  async detect(source: HTMLVideoElement | HTMLImageElement, enabledClasses?: Set<string>): Promise<Detection[]> {
    if (!this.session) return [];

    const ort = await getOrt();
    const vw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const vh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (vw === 0 || vh === 0) return [];

    // Reuse offscreen canvas for preprocessing
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

    // Convert RGBA → CHW float32 normalized [0, 1]
    // Reuse pre-allocated buffer to avoid ~4.9MB allocation per frame
    const area = INPUT_SIZE * INPUT_SIZE;
    const inputSize = 3 * area;
    if (!this.float32Buf || this.float32Buf.length !== inputSize) {
      this.float32Buf = new Float32Array(inputSize);
    }
    const float32Data = this.float32Buf;

    for (let i = 0; i < area; i++) {
      const ri = i * 4;
      float32Data[i] = pixels[ri] / 255;           // R
      float32Data[area + i] = pixels[ri + 1] / 255; // G
      float32Data[2 * area + i] = pixels[ri + 2] / 255; // B
    }

    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]);

    const results = await this.session.run({ images: inputTensor });

    // YOLOv8 output shape: [1, 84, 8400] — 84 = 4 bbox + 80 classes
    const output = results[Object.keys(results)[0]];
    const data = output.data;
    const numDetections = output.dims[2]; // 8400

    const detections: Detection[] = [];

    for (let i = 0; i < numDetections; i++) {
      // Find best class
      let maxConf = 0;
      let maxClassId = 0;
      for (let c = 0; c < 80; c++) {
        const conf = data[(4 + c) * numDetections + i];
        if (conf > maxConf) {
          maxConf = conf;
          maxClassId = c;
        }
      }

      if (maxConf < CONF_THRESHOLD) continue;
      if (!ENABLED_CLASS_IDS.has(maxClassId)) continue;

      const classInfo = COCO_CLASSES[maxClassId];
      if (!classInfo) continue;

      // Filter by enabled classes
      if (enabledClasses && !enabledClasses.has(classInfo.type)) continue;

      // Extract bbox (cx, cy, w, h) in input coords
      const cx = data[0 * numDetections + i];
      const cy = data[1 * numDetections + i];
      const bw = data[2 * numDetections + i];
      const bh = data[3 * numDetections + i];

      // Convert from letterbox input coords → normalized 0-1 original image coords
      const x1 = (cx - bw / 2 - padX) / nw;
      const y1 = (cy - bh / 2 - padY) / nh;
      const w = bw / nw;
      const h = bh / nh;

      // Skip out-of-frame boxes
      if (x1 + w < 0 || y1 + h < 0 || x1 > 1 || y1 > 1) continue;

      detections.push({
        type: classInfo.type,
        label: classInfo.label,
        confidence: maxConf,
        bbox: {
          x: Math.max(0, x1),
          y: Math.max(0, y1),
          w: Math.min(w, 1 - Math.max(0, x1)),
          h: Math.min(h, 1 - Math.max(0, y1)),
        },
        classId: maxClassId,
        color: classInfo.color,
      });
    }

    // NMS: greedy, sort by confidence desc
    return this.nms(detections);
  }

  private nms(detections: Detection[]): Detection[] {
    detections.sort((a, b) => b.confidence - a.confidence);
    const kept: Detection[] = [];

    for (const det of detections) {
      const dominated = kept.some(k => {
        if (k.type !== det.type) return false;
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

  dispose(): void {
    this.session?.release();
    this.session = null;
    this._backend = null;
    this.canvas = null;
    this.ctx = null;
    this.float32Buf = null;
  }
}

// Singleton (survives HMR via globalThis)
const globalKey = '__browserYolo';
const g = globalThis as unknown as Record<string, BrowserYolo | undefined>;

export const browserYolo: BrowserYolo = g[globalKey] ?? new BrowserYolo();
if (typeof window !== 'undefined') {
  g[globalKey] = browserYolo;
}

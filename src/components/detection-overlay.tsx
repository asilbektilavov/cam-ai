'use client';

import { useRef, useEffect } from 'react';

export interface Detection {
  type: string;
  label: string;
  confidence: number;
  bbox: {
    x: number; // normalized 0-1
    y: number;
    w: number;
    h: number;
  };
  classId: number;
  color: string;
}

interface DetectionOverlayProps {
  detections: Detection[];
  visible: boolean;
}

const CORNER_LEN = 12;
const LINE_WIDTH = 2;
const FONT = '11px Inter, system-ui, sans-serif';
const LERP_SPEED = 0.25; // 0-1, higher = snappier tracking
const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;

/** Linearly interpolate a single value */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Compute IoU (Intersection over Union) of two normalized bboxes */
function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

interface TrackedBox {
  // Current animated position (what we draw)
  cx: number; cy: number; cw: number; ch: number;
  // Target position (from latest YOLO)
  tx: number; ty: number; tw: number; th: number;
  label: string;
  confidence: number;
  color: string;
  type: string;
  age: number; // frames since last matched
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  box: TrackedBox,
  canvasW: number,
  canvasH: number
) {
  const x = box.cx * canvasW;
  const y = box.cy * canvasH;
  const w = box.cw * canvasW;
  const h = box.ch * canvasH;
  const color = box.color;

  // Fade out dying boxes
  const alpha = box.age > 0 ? Math.max(0, 1 - box.age * 0.3) : 1;
  ctx.globalAlpha = alpha;

  // Main rectangle
  ctx.strokeStyle = color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);

  // Corner accents
  ctx.lineWidth = 3;
  const cl = Math.min(CORNER_LEN, w / 3, h / 3);

  ctx.beginPath();
  ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y + h - cl); ctx.lineTo(x, y + h); ctx.lineTo(x + cl, y + h);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w - cl, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cl);
  ctx.stroke();

  // Label
  const label = `${box.label} ${Math.round(box.confidence * 100)}%`;
  ctx.font = FONT;
  const textW = ctx.measureText(label).width + 8;
  const textH = 18;
  const labelY = Math.max(y - textH, 0);

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillRect(x, labelY, textW, textH);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, x + 4, labelY + 13);

  ctx.globalAlpha = 1;
}

export function DetectionOverlay({ detections, visible }: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef<TrackedBox[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  // Update targets when new detections arrive
  useEffect(() => {
    const prev = trackedRef.current;
    const matched = new Set<number>();
    const newTracked: TrackedBox[] = [];

    for (const det of detections) {
      // Skip tiny detections (noise) — must be at least 3% of frame in each dimension
      if (det.bbox.w < 0.03 || det.bbox.h < 0.05) continue;

      // Find best matching previous box by IoU
      let bestIdx = -1;
      let bestIoU = 0.15; // minimum IoU threshold to match
      for (let i = 0; i < prev.length; i++) {
        if (matched.has(i)) continue;
        const score = iou(
          { x: prev[i].tx, y: prev[i].ty, w: prev[i].tw, h: prev[i].th },
          det.bbox
        );
        if (score > bestIoU) {
          bestIoU = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        // Update existing tracked box — keep current animated pos, update target
        matched.add(bestIdx);
        const old = prev[bestIdx];
        newTracked.push({
          cx: old.cx, cy: old.cy, cw: old.cw, ch: old.ch,
          tx: det.bbox.x, ty: det.bbox.y, tw: det.bbox.w, th: det.bbox.h,
          label: det.label,
          confidence: det.confidence,
          color: det.color,
          type: det.type,
          age: 0,
        });
      } else {
        // New detection — start at target position immediately
        newTracked.push({
          cx: det.bbox.x, cy: det.bbox.y, cw: det.bbox.w, ch: det.bbox.h,
          tx: det.bbox.x, ty: det.bbox.y, tw: det.bbox.w, th: det.bbox.h,
          label: det.label,
          confidence: det.confidence,
          color: det.color,
          type: det.type,
          age: 0,
        });
      }
    }

    // Keep unmatched old boxes briefly (quick fade out)
    for (let i = 0; i < prev.length; i++) {
      if (!matched.has(i) && prev[i].age < 4) {
        newTracked.push({ ...prev[i], age: prev[i].age + 1 });
      }
    }

    trackedRef.current = newTracked;
  }, [detections]);

  // 30fps render loop with lerp interpolation
  useEffect(() => {
    let running = true;

    const tick = (now: number) => {
      if (!running) return;

      // Throttle to TARGET_FPS
      const elapsed = now - lastFrameRef.current;
      if (elapsed < FRAME_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameRef.current = now;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (visible) {
        const boxes = trackedRef.current;
        for (const box of boxes) {
          // Lerp current position toward target
          box.cx = lerp(box.cx, box.tx, LERP_SPEED);
          box.cy = lerp(box.cy, box.ty, LERP_SPEED);
          box.cw = lerp(box.cw, box.tw, LERP_SPEED);
          box.ch = lerp(box.ch, box.th, LERP_SPEED);
          drawBox(ctx, box, rect.width, rect.height);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  );
}

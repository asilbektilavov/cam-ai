'use client';

import { useRef, useEffect, useCallback } from 'react';

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

// ── Visual constants ──────────────────────────────────────────────────
const CORNER_LEN = 12;
const LINE_WIDTH = 2;
const FONT = '11px Inter, system-ui, sans-serif';
const TARGET_FPS = 60;
const FRAME_MS = 1000 / TARGET_FPS;

// ── Tracking tuning ──────────────────────────────────────────────────
// Pipeline latency: time from frame capture to detection arriving on frontend
// poll interval (~100ms) + YOLO inference (~50ms) + SSE transit (~5ms)
const PIPELINE_LATENCY_MS = 155;

const VELOCITY_SMOOTH = 0.3;      // EMA factor for velocity (lower = faster adaptation)
const MAX_COAST_MS = 1200;        // Keep predicting without new detection
const FADE_START_MS = 600;        // Start fading after this many ms
const IOU_THRESHOLD = 0.08;       // Minimum IoU to match (low for fast motion)
const MIN_BOX_W = 0.02;
const MIN_BOX_H = 0.03;
const MAX_V_PER_MS = 0.004;       // Max velocity in normalized units per ms (~4x frame/sec)

// ── Tracked box ───────────────────────────────────────────────────────
// Instead of tracking a "rendered position" that drifts with alpha-beta,
// we anchor to the LAST DETECTION position and extrapolate forward using
// smoothed velocity + pipeline latency compensation.  This eliminates the
// fundamental lag caused by alpha-beta pulling the box toward a stale position.
interface TrackedBox {
  // Last detection position (our anchor — where YOLO saw the object)
  dx: number; dy: number; dw: number; dh: number;
  // Smoothed velocity (normalized units per ms)
  vx: number; vy: number; vw: number; vh: number;
  // Metadata
  label: string;
  confidence: number;
  color: string;
  type: string;
  // Timing
  lastDetTime: number;   // rAF timestamp when detection was processed
  hitCount: number;
}

// ── IoU ───────────────────────────────────────────────────────────────
function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Component ─────────────────────────────────────────────────────────
export function DetectionOverlay({ detections, visible }: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef<TrackedBox[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const pendingRef = useRef<Detection[] | null>(null);

  useEffect(() => {
    pendingRef.current = detections;
  }, [detections]);

  // ── Process new detections: match by IoU, update velocity ──────────
  const processDetections = useCallback((dets: Detection[], now: number) => {
    const prev = trackedRef.current;
    const filtered = dets.filter(d => d.bbox.w >= MIN_BOX_W && d.bbox.h >= MIN_BOX_H);

    // For matching: extrapolate each track's detection position forward
    // by elapsed time (detection-to-detection), so we compare at the
    // same physical time as the new detection.
    const scores: { ti: number; di: number; s: number }[] = [];
    for (let ti = 0; ti < prev.length; ti++) {
      const t = prev[ti];
      const dt = now - t.lastDetTime; // time between receive events ≈ time between captures
      const predX = t.dx + t.vx * dt;
      const predY = t.dy + t.vy * dt;
      const predW = Math.max(MIN_BOX_W, t.dw + t.vw * dt);
      const predH = Math.max(MIN_BOX_H, t.dh + t.vh * dt);
      for (let di = 0; di < filtered.length; di++) {
        const s = iou({ x: predX, y: predY, w: predW, h: predH }, filtered[di].bbox);
        if (s > IOU_THRESHOLD) scores.push({ ti, di, s });
      }
    }
    scores.sort((a, b) => b.s - a.s);

    const usedT = new Set<number>();
    const usedD = new Set<number>();
    const result: TrackedBox[] = [];

    // ── Matched tracks: compute velocity from detection-to-detection ──
    for (const { ti, di } of scores) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);

      const box = prev[ti];
      const det = filtered[di];
      const dtMs = now - box.lastDetTime;

      if (dtMs > 1) {
        // Raw velocity: detection position change / time
        const rawVx = (det.bbox.x - box.dx) / dtMs;
        const rawVy = (det.bbox.y - box.dy) / dtMs;
        const rawVw = (det.bbox.w - box.dw) / dtMs;
        const rawVh = (det.bbox.h - box.dh) / dtMs;

        if (box.hitCount <= 2) {
          // Bootstrap: use raw velocity directly for first few frames
          box.vx = clamp(rawVx, -MAX_V_PER_MS, MAX_V_PER_MS);
          box.vy = clamp(rawVy, -MAX_V_PER_MS, MAX_V_PER_MS);
          box.vw = clamp(rawVw, -MAX_V_PER_MS / 2, MAX_V_PER_MS / 2);
          box.vh = clamp(rawVh, -MAX_V_PER_MS / 2, MAX_V_PER_MS / 2);
        } else {
          // EMA smoothing: vx = smooth * old + (1-smooth) * new
          const s = VELOCITY_SMOOTH;
          box.vx = clamp(s * box.vx + (1 - s) * rawVx, -MAX_V_PER_MS, MAX_V_PER_MS);
          box.vy = clamp(s * box.vy + (1 - s) * rawVy, -MAX_V_PER_MS, MAX_V_PER_MS);
          box.vw = clamp(s * box.vw + (1 - s) * rawVw, -MAX_V_PER_MS / 2, MAX_V_PER_MS / 2);
          box.vh = clamp(s * box.vh + (1 - s) * rawVh, -MAX_V_PER_MS / 2, MAX_V_PER_MS / 2);
        }
      }

      // Update detection anchor
      box.dx = det.bbox.x;
      box.dy = det.bbox.y;
      box.dw = det.bbox.w;
      box.dh = det.bbox.h;
      box.label = det.label;
      box.confidence = det.confidence;
      box.color = det.color;
      box.lastDetTime = now;
      box.hitCount++;
      result.push(box);
    }

    // ── Unmatched tracks — coast ──
    for (let ti = 0; ti < prev.length; ti++) {
      if (usedT.has(ti)) continue;
      const t = prev[ti];
      if (now - t.lastDetTime < MAX_COAST_MS) {
        // Apply velocity decay during coasting to avoid runaway
        const coastMs = now - t.lastDetTime;
        const decay = Math.exp(-coastMs / 400); // half-life ~275ms
        t.vx *= decay;
        t.vy *= decay;
        result.push(t);
      }
    }

    // ── Unmatched detections — new boxes ──
    for (let di = 0; di < filtered.length; di++) {
      if (usedD.has(di)) continue;
      const d = filtered[di];
      result.push({
        dx: d.bbox.x, dy: d.bbox.y, dw: d.bbox.w, dh: d.bbox.h,
        vx: 0, vy: 0, vw: 0, vh: 0,
        label: d.label, confidence: d.confidence, color: d.color, type: d.type,
        lastDetTime: now,
        hitCount: 1,
      });
    }

    trackedRef.current = result;
  }, []);

  // ── 60fps render loop ───────────────────────────────────────────────
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

      // Process any pending detections
      const pending = pendingRef.current;
      if (pending !== null) {
        pendingRef.current = null;
        processDetections(pending, now);
      }

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

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
        const alive: TrackedBox[] = [];

        for (const box of boxes) {
          const sinceDet = now - box.lastDetTime;
          if (sinceDet >= MAX_COAST_MS) continue;

          // ── Compute render position ────────────────────────────
          // The detection was CAPTURED at approximately:
          //   T_capture = T_receive - PIPELINE_LATENCY
          // The detection position (dx,dy) is where the object was at T_capture.
          // Time since capture = sinceDet + PIPELINE_LATENCY_MS.
          // Extrapolate from detection anchor using velocity:
          const totalElapsed = sinceDet + PIPELINE_LATENCY_MS;
          let rx = box.dx + box.vx * totalElapsed;
          let ry = box.dy + box.vy * totalElapsed;
          let rw = box.dw + box.vw * totalElapsed;
          let rh = box.dh + box.vh * totalElapsed;

          // Clamp to frame
          rw = Math.max(MIN_BOX_W, Math.min(1, rw));
          rh = Math.max(MIN_BOX_H, Math.min(1, rh));
          rx = clamp(rx, 0, 1 - rw);
          ry = clamp(ry, 0, 1 - rh);

          // ── Fade computation ──
          let alpha = 1;
          if (sinceDet > FADE_START_MS) {
            alpha = 1 - (sinceDet - FADE_START_MS) / (MAX_COAST_MS - FADE_START_MS);
          }

          drawBox(ctx, rx, ry, rw, rh, box, rect.width, rect.height, alpha);
          alive.push(box);
        }

        trackedRef.current = alive;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [visible, processDetections]);

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

// ── Draw a single box ─────────────────────────────────────────────────
function drawBox(
  ctx: CanvasRenderingContext2D,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
  box: TrackedBox,
  canvasW: number,
  canvasH: number,
  alpha: number,
) {
  const x = nx * canvasW;
  const y = ny * canvasH;
  const w = nw * canvasW;
  const h = nh * canvasH;
  const color = box.color;

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

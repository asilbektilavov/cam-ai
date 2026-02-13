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
  pipelineLatencyMs?: number;
}

const CORNER_LEN = 12;
const LINE_WIDTH = 2;
const FONT = '11px Inter, system-ui, sans-serif';

export function DetectionOverlay({ detections, visible }: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const detectionsRef = useRef<Detection[]>([]);

  useEffect(() => {
    detectionsRef.current = detections;
  }, [detections]);

  useEffect(() => {
    let running = true;
    let rafId = 0;
    // Cached canvas dimensions — only updated on resize (every 1s check)
    let cachedW = 0;
    let cachedH = 0;
    let lastSizeCheck = 0;
    const SIZE_CHECK_INTERVAL = 1000;

    const draw = () => {
      if (!running) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      // Check container size at most once per second (avoids layout thrashing)
      const now = performance.now();
      if (now - lastSizeCheck > SIZE_CHECK_INTERVAL || cachedW === 0) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width !== cachedW || rect.height !== cachedH)) {
          cachedW = rect.width;
          cachedH = rect.height;
          const dpr = window.devicePixelRatio || 1;
          canvas.width = cachedW * dpr;
          canvas.height = cachedH * dpr;
          canvas.style.width = `${cachedW}px`;
          canvas.style.height = `${cachedH}px`;
        }
        lastSizeCheck = now;
      }

      if (cachedW === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      // setTransform resets to identity*dpr in one call (no accumulation)
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cachedW, cachedH);

      const dets = detectionsRef.current;
      if (visible && dets.length > 0) {
        for (const det of dets) {
          drawBox(ctx, det, cachedW, cachedH);
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
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
        style={{ opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  det: Detection,
  canvasW: number,
  canvasH: number,
) {
  const x = det.bbox.x * canvasW;
  const y = det.bbox.y * canvasH;
  const w = det.bbox.w * canvasW;
  const h = det.bbox.h * canvasH;
  const color = det.color;

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
  const label = `${det.label} ${Math.round(det.confidence * 100)}%`;
  ctx.font = FONT;
  const textW = ctx.measureText(label).width + 8;
  const textH = 18;
  const labelY = Math.max(y - textH, 0);

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x, labelY, textW, textH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, x + 4, labelY + 13);
}

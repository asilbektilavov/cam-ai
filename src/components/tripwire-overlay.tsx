'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface TripwireLine {
  x1: number; // 0-1 normalized
  y1: number;
  x2: number;
  y2: number;
  enabled: boolean;
}

interface TripwireOverlayProps {
  /** Container element to overlay on */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current tripwire line config */
  line: TripwireLine | null;
  /** Called when line is changed by user */
  onLineChange: (line: TripwireLine) => void;
  /** Whether editing is enabled (drawing/dragging) */
  editable: boolean;
  /** Show line crossing events from server */
  events?: Array<{
    type: string;
    bbox: { x: number; y: number; w: number; h: number };
    trackId?: number;
    crossed?: boolean;
    name?: string | null;
    confidence?: number;
  }>;
}

type DragTarget = 'p1' | 'p2' | null;

const LINE_COLOR = '#F59E0B';      // amber
const LINE_COLOR_ACTIVE = '#EF4444'; // red when crossing
const POINT_RADIUS = 8;
const LINE_WIDTH = 3;
const BODY_COLOR = '#3B82F6';       // blue
const CROSSED_COLOR = '#22C55E';    // green
const FACE_COLOR = '#A855F7';       // purple

export function TripwireOverlay({
  containerRef,
  line,
  onLineChange,
  editable,
  events = [],
}: TripwireOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const animRef = useRef<number>(0);

  const getCanvasCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  const isNearPoint = useCallback((mx: number, my: number, px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const threshold = POINT_RADIUS * 2 / Math.min(canvas.width, canvas.height);
    return Math.hypot(mx - px, my - py) < threshold;
  }, []);

  // Resize canvas to match container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    });
    observer.observe(container);
    // Initial size
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    return () => observer.disconnect();
  }, [containerRef]);

  // Draw loop
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      const hasCrossing = events.some(e => e.crossed);

      // Draw tripwire line
      if (line && line.enabled) {
        const x1 = line.x1 * w;
        const y1 = line.y1 * h;
        const x2 = line.x2 * w;
        const y2 = line.y2 * h;

        // Line glow
        ctx.save();
        ctx.shadowColor = hasCrossing ? LINE_COLOR_ACTIVE : LINE_COLOR;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = hasCrossing ? LINE_COLOR_ACTIVE : LINE_COLOR;
        ctx.lineWidth = LINE_WIDTH;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();

        // Direction arrow (perpendicular to line, showing crossing direction)
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const angle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
        const arrowLen = 15;
        ctx.strokeStyle = hasCrossing ? LINE_COLOR_ACTIVE : LINE_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(angle) * arrowLen, my + Math.sin(angle) * arrowLen);
        ctx.stroke();

        // Endpoints (only when editable)
        if (editable) {
          for (const [px, py] of [[x1, y1], [x2, y2]]) {
            ctx.fillStyle = LINE_COLOR;
            ctx.beginPath();
            ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        // Label
        ctx.fillStyle = hasCrossing ? LINE_COLOR_ACTIVE : LINE_COLOR;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TRIPWIRE', mx, Math.min(y1, y2) - 10);
      }

      // Draw events overlay (bodies + faces from line-crossing-service)
      for (const ev of events) {
        const bx = ev.bbox.x * w;
        const by = ev.bbox.y * h;
        const bw = ev.bbox.w * w;
        const bh = ev.bbox.h * h;

        let color = BODY_COLOR;
        if (ev.type === 'face') color = FACE_COLOR;
        else if (ev.crossed && ev.name) color = CROSSED_COLOR;
        else if (ev.crossed) color = LINE_COLOR_ACTIVE;

        // Bbox
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bx, by, bw, bh);

        // Label
        if (ev.name) {
          const label = `${ev.name} ${ev.confidence ? Math.round(ev.confidence * 100) + '%' : ''}`;
          ctx.font = 'bold 11px sans-serif';
          const tm = ctx.measureText(label);
          const lh = 16;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(bx, by - lh - 2, tm.width + 8, lh + 2);
          ctx.fillStyle = color;
          ctx.fillText(label, bx + 4, by - 4);
        }

        // Track ID
        if (ev.trackId !== undefined && ev.type === 'body') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(bx, by + bh - 16, 24, 16);
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          ctx.fillText(`#${ev.trackId}`, bx + 3, by + bh - 4);
        }
      }

      // Drawing preview (when user is creating a new line)
      if (drawingStart) {
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(drawingStart.x * w, drawingStart.y * h);
        // Line follows cursor — handled by onMouseMove storing temp endpoint
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [line, editable, events, drawingStart]);

  // Mouse handlers for drawing/dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editable) return;
    const { x, y } = getCanvasCoords(e);

    // Check if clicking near existing endpoints
    if (line && line.enabled) {
      if (isNearPoint(x, y, line.x1, line.y1)) {
        setDragging('p1');
        return;
      }
      if (isNearPoint(x, y, line.x2, line.y2)) {
        setDragging('p2');
        return;
      }
    }

    // Start drawing new line
    setDrawingStart({ x, y });
  }, [editable, line, getCanvasCoords, isNearPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editable) return;
    const { x, y } = getCanvasCoords(e);

    if (dragging && line) {
      const updated = { ...line };
      if (dragging === 'p1') {
        updated.x1 = Math.max(0, Math.min(1, x));
        updated.y1 = Math.max(0, Math.min(1, y));
      } else {
        updated.x2 = Math.max(0, Math.min(1, x));
        updated.y2 = Math.max(0, Math.min(1, y));
      }
      onLineChange(updated);
    }

    // Update cursor
    const canvas = canvasRef.current;
    if (canvas && line && line.enabled) {
      if (isNearPoint(x, y, line.x1, line.y1) || isNearPoint(x, y, line.x2, line.y2)) {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = editable ? 'crosshair' : 'default';
      }
    }
  }, [editable, dragging, line, getCanvasCoords, isNearPoint, onLineChange]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setDragging(null);
      return;
    }

    if (drawingStart) {
      const { x, y } = getCanvasCoords(e);
      // Minimum distance to create a line
      const dist = Math.hypot(x - drawingStart.x, y - drawingStart.y);
      if (dist > 0.03) {
        onLineChange({
          x1: drawingStart.x,
          y1: drawingStart.y,
          x2: x,
          y2: y,
          enabled: true,
        });
      }
      setDrawingStart(null);
    }
  }, [dragging, drawingStart, getCanvasCoords, onLineChange]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: editable ? 'auto' : 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        setDragging(null);
        setDrawingStart(null);
      }}
    />
  );
}

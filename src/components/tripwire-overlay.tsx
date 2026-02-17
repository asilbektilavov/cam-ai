'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export type CrossDirection = 'forward' | 'backward';
export type LineType = 'free' | 'vertical';

export interface TripwireLine {
  x1: number; // 0-1 normalized
  y1: number;
  x2: number;
  y2: number;
  enabled: boolean;
  crossDirection?: CrossDirection; // 'forward' = arrow direction, 'backward' = against arrow
  lineType?: LineType; // 'free' = any angle (default), 'vertical' = strict vertical
}

export interface LineCrossingEvent {
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
  trackId?: number;
  crossed?: boolean;
  name?: string | null;
  confidence?: number;
}

export interface BrowserFace {
  bbox: { x: number; y: number; w: number; h: number };
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
  events?: LineCrossingEvent[];
  /** Browser-detected faces (fast ~24fps) — shown as red until crossed */
  browserFaces?: BrowserFace[];
}

type DragTarget = 'p1' | 'p2' | null;

const LINE_COLOR = '#F59E0B';      // amber
const LINE_COLOR_ACTIVE = '#EF4444'; // red when crossing
const POINT_RADIUS = 8;
const LINE_WIDTH = 3;
const BODY_COLOR = '#3B82F6';       // blue
const CROSSED_COLOR = '#22C55E';    // green
const FACE_NOT_CROSSED = '#EF4444'; // red — not crossed yet
const FACE_CROSSED = '#22C55E';     // green — crossed + recognized
const MATCH_DIST = 0.25;           // max center distance for face matching

export function TripwireOverlay({
  containerRef,
  line,
  onLineChange,
  editable,
  events = [],
  browserFaces = [],
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
        const baseAngle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
        const dir = line.crossDirection || 'forward';
        const arrowLen = 45;
        const headLen = 14;

        const arrowGap = 12; // gap between line and arrow tip
        const drawArrow = (angle: number, color: string) => {
          // Arrow points FROM outside TOWARD the line, with gap
          const tipX = mx + Math.cos(angle) * arrowGap;
          const tipY = my + Math.sin(angle) * arrowGap;
          const sx = mx + Math.cos(angle) * (arrowGap + arrowLen);
          const sy = my + Math.sin(angle) * (arrowGap + arrowLen);
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
          // Arrowhead at the tip (near line)
          const tipAngle = angle + Math.PI; // pointing inward
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - headLen * Math.cos(tipAngle - 0.4), tipY - headLen * Math.sin(tipAngle - 0.4));
          ctx.lineTo(tipX - headLen * Math.cos(tipAngle + 0.4), tipY - headLen * Math.sin(tipAngle + 0.4));
          ctx.closePath();
          ctx.fill();
        };

        const arrowColor = hasCrossing ? LINE_COLOR_ACTIVE : '#22C55E';
        const dimColor = 'rgba(255,255,255,0.3)';

        if (dir === 'forward') {
          drawArrow(baseAngle, arrowColor);
          drawArrow(baseAngle + Math.PI, dimColor);
        } else {
          drawArrow(baseAngle + Math.PI, arrowColor);
          drawArrow(baseAngle, dimColor);
        }

        // Direction label
        const isVert = (line.lineType || 'free') === 'vertical';
        // Dynamic direction labels based on actual arrow angle
        let dirLabels: Record<string, string>;
        if (isVert) {
          dirLabels = {
            forward: '← Идут слева',
            backward: '→ Идут справа',
          };
        } else {
          // Determine dominant direction from arrow angle
          const fwdCos = Math.cos(baseAngle);
          const fwdSin = Math.sin(baseAngle);
          let fwdLabel: string;
          let bwdLabel: string;
          if (Math.abs(fwdCos) > Math.abs(fwdSin)) {
            // Horizontal dominant
            fwdLabel = fwdCos > 0 ? '← Идут справа' : '→ Идут слева';
            bwdLabel = fwdCos > 0 ? '→ Идут слева' : '← Идут справа';
          } else {
            // Vertical dominant
            fwdLabel = fwdSin > 0 ? '↑ Идут снизу' : '↓ Идут сверху';
            bwdLabel = fwdSin > 0 ? '↓ Идут сверху' : '↑ Идут снизу';
          }
          dirLabels = { forward: fwdLabel, backward: bwdLabel };
        }
        const labelY = Math.max(y1, y2) + 18;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        const dirLabel = dirLabels[dir] || dirLabels.forward;
        const labelW = ctx.measureText(dirLabel).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(mx - labelW / 2, labelY - 10, labelW, 14);
        ctx.fillStyle = arrowColor;
        ctx.fillText(dirLabel, mx, labelY);

        // Line type label (only for vertical)
        if (isVert) {
          const typeLabel = '┃ Вертикальная';
          const typeLabelY = Math.min(y1, y2) - 24;
          const typeLabelW = ctx.measureText(typeLabel).width + 10;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(mx - typeLabelW / 2, typeLabelY - 10, typeLabelW, 14);
          ctx.fillStyle = LINE_COLOR;
          ctx.fillText(typeLabel, mx, typeLabelY);
        }

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

      }

      // Draw browser face bboxes (fast ~24fps) merged with server crossing events
      // Red = not crossed yet, Green = crossed + recognized with name
      const serverFaces = events.filter(e => e.type === 'face' && e.crossed && e.name);
      const usedServerFaces = new Set<number>();

      for (const bf of browserFaces) {
        const bx = bf.bbox.x * w;
        const by = bf.bbox.y * h;
        const bw = bf.bbox.w * w;
        const bh = bf.bbox.h * h;
        const bfCx = bf.bbox.x + bf.bbox.w / 2;
        const bfCy = bf.bbox.y + bf.bbox.h / 2;

        // Try to match with server-recognized crossed face
        let matchedName: string | null = null;
        let matchedConf = 0;
        let bestDist = MATCH_DIST;

        for (let i = 0; i < serverFaces.length; i++) {
          if (usedServerFaces.has(i)) continue;
          const sf = serverFaces[i];
          const sfCx = sf.bbox.x + sf.bbox.w / 2;
          const sfCy = sf.bbox.y + sf.bbox.h / 2;
          const dist = Math.sqrt((bfCx - sfCx) ** 2 + (bfCy - sfCy) ** 2);
          if (dist < bestDist) {
            bestDist = dist;
            matchedName = sf.name ?? null;
            matchedConf = sf.confidence ?? 0;
            usedServerFaces.add(i);
          }
        }

        const color = matchedName ? FACE_CROSSED : FACE_NOT_CROSSED;

        // Bbox
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bx, by, bw, bh);

        // Label (name + confidence for crossed faces)
        if (matchedName) {
          const label = `${matchedName} ${matchedConf ? Math.round(matchedConf * 100) + '%' : ''}`;
          ctx.font = 'bold 11px sans-serif';
          const tm = ctx.measureText(label);
          const lh = 16;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(bx, by - lh - 2, tm.width + 8, lh + 2);
          ctx.fillStyle = color;
          ctx.fillText(label, bx + 4, by - 4);
        }
      }

      // Draw server body/event overlays (bodies tracked by YOLO)
      for (const ev of events) {
        if (ev.type === 'face') continue; // faces drawn via browserFaces merge above
        const bx = ev.bbox.x * w;
        const by = ev.bbox.y * h;
        const bw = ev.bbox.w * w;
        const bh = ev.bbox.h * h;

        let color = BODY_COLOR;
        if (ev.crossed && ev.name) color = CROSSED_COLOR;
        else if (ev.crossed) color = LINE_COLOR_ACTIVE;

        // Bbox
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bx, by, bw, bh);

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
  }, [line, editable, events, browserFaces, drawingStart]);

  // Check if click is near the arrow area (center of line)
  const isNearArrow = useCallback((mx: number, my: number) => {
    if (!line || !line.enabled) return false;
    const cx = (line.x1 + line.x2) / 2;
    const cy = (line.y1 + line.y2) / 2;
    return Math.hypot(mx - cx, my - cy) < 0.06;
  }, [line]);

  // Check if click is near the type label (above the line)
  const isNearTypeLabel = useCallback((mx: number, my: number) => {
    if (!line || !line.enabled) return false;
    const cx = (line.x1 + line.x2) / 2;
    const topY = Math.min(line.y1, line.y2);
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const labelY = topY - 24 / canvas.height;
    return Math.abs(mx - cx) < 0.08 && Math.abs(my - labelY) < 0.025;
  }, [line]);

  // Toggle direction: forward ↔ backward
  const cycleDirection = useCallback(() => {
    if (!line) return;
    const cur = line.crossDirection || 'forward';
    const next: CrossDirection = cur === 'forward' ? 'backward' : 'forward';
    onLineChange({ ...line, crossDirection: next });
  }, [line, onLineChange]);

  // Toggle line type: free ↔ vertical
  const toggleLineType = useCallback(() => {
    if (!line) return;
    const cur = line.lineType || 'free';
    const next: LineType = cur === 'free' ? 'vertical' : 'free';
    if (next === 'vertical') {
      // Snap to vertical — use average x for both points
      const avgX = (line.x1 + line.x2) / 2;
      onLineChange({ ...line, lineType: next, x1: avgX, x2: avgX });
    } else {
      onLineChange({ ...line, lineType: next });
    }
  }, [line, onLineChange]);

  // Mouse handlers for drawing/dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editable) return;
    const { x, y } = getCanvasCoords(e);

    // Check if clicking on type label — toggle line type
    if (line && line.enabled && isNearTypeLabel(x, y)) {
      toggleLineType();
      return;
    }

    // Check if clicking on direction arrow — cycle direction
    if (line && line.enabled && isNearArrow(x, y)) {
      cycleDirection();
      return;
    }

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
  }, [editable, line, getCanvasCoords, isNearPoint, isNearArrow, isNearTypeLabel, cycleDirection, toggleLineType]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editable) return;
    const { x, y } = getCanvasCoords(e);

    if (dragging && line) {
      const updated = { ...line };
      const isVert = (line.lineType || 'free') === 'vertical';
      if (dragging === 'p1') {
        updated.x1 = Math.max(0, Math.min(1, x));
        updated.y1 = Math.max(0, Math.min(1, y));
        if (isVert) updated.x2 = updated.x1; // keep vertical
      } else {
        updated.x2 = Math.max(0, Math.min(1, x));
        updated.y2 = Math.max(0, Math.min(1, y));
        if (isVert) updated.x1 = updated.x2; // keep vertical
      }
      onLineChange(updated);
    }

    // Update cursor
    const canvas = canvasRef.current;
    if (canvas && line && line.enabled) {
      if (isNearTypeLabel(x, y) || isNearArrow(x, y)) {
        canvas.style.cursor = 'pointer';
      } else if (isNearPoint(x, y, line.x1, line.y1) || isNearPoint(x, y, line.x2, line.y2)) {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = editable ? 'crosshair' : 'default';
      }
    }
  }, [editable, dragging, line, getCanvasCoords, isNearPoint, isNearArrow, isNearTypeLabel, onLineChange]);

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

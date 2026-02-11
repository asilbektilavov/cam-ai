'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';

interface LinePoint {
  x: number;
  y: number;
}

interface LineCrossingConfigProps {
  cameraId: string;
  config: {
    linePoints?: LinePoint[];
    direction?: 'in' | 'out' | 'both';
  };
  onChange: (config: { linePoints: LinePoint[]; direction: 'in' | 'out' | 'both' }) => void;
}

export function LineCrossingConfig({ cameraId, config, onChange }: LineCrossingConfigProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<LinePoint[]>(config.linePoints ?? []);
  const [direction, setDirection] = useState<'in' | 'out' | 'both'>(config.direction ?? 'both');
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 180 });

  // Load snapshot as background
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `/api/cameras/${cameraId}/snapshot?t=${Date.now()}`;
    img.onload = () => setBgImage(img);
    img.onerror = () => setBgImage(null);
  }, [cameraId]);

  // Fit canvas to container width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = Math.min(container.clientWidth, 400);
    setCanvasSize({ width: w, height: Math.round(w * 9 / 16) });
  }, []);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvasSize;
    ctx.clearRect(0, 0, width, height);

    // Background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#555';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Нет снимка — кликните для рисования линии', width / 2, height / 2);
    }

    // Draw line
    if (points.length >= 1) {
      const p1 = { x: points[0].x * width, y: points[0].y * height };

      if (points.length === 2) {
        const p2 = { x: points[1].x * width, y: points[1].y * height };

        // Dashed line
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Direction arrow at midpoint
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          // Normal vector (perpendicular to line)
          const nx = -dy / len;
          const ny = dx / len;
          const arrowLen = 15;

          if (direction === 'in' || direction === 'both') {
            drawArrow(ctx, mx, my, mx + nx * arrowLen, my + ny * arrowLen, '#22c55e');
          }
          if (direction === 'out' || direction === 'both') {
            drawArrow(ctx, mx, my, mx - nx * arrowLen, my - ny * arrowLen, '#ef4444');
          }
        }

        // Second point
        drawPoint(ctx, p2.x, p2.y);
      }

      // First point
      drawPoint(ctx, p1.x, p1.y);
    }
  }, [points, direction, bgImage, canvasSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    let newPoints: LinePoint[];
    if (points.length < 2) {
      newPoints = [...points, { x, y }];
    } else {
      // Reset and start new line
      newPoints = [{ x, y }];
    }
    setPoints(newPoints);
    if (newPoints.length === 2) {
      onChange({ linePoints: newPoints, direction });
    }
  };

  const handleDirectionChange = (val: string) => {
    const d = val as 'in' | 'out' | 'both';
    setDirection(d);
    if (points.length === 2) {
      onChange({ linePoints: points, direction: d });
    }
  };

  const handleClear = () => {
    setPoints([]);
    onChange({ linePoints: [], direction });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Виртуальная линия</Label>
        <p className="text-xs text-muted-foreground">
          Кликните две точки на превью для задания линии пересечения
        </p>
      </div>

      <div ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="rounded-md border cursor-crosshair w-full"
          style={{ imageRendering: 'auto' }}
          onClick={handleCanvasClick}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Направление</Label>
          <Select value={direction} onValueChange={handleDirectionChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">Вход</SelectItem>
              <SelectItem value="out">Выход</SelectItem>
              <SelectItem value="both">Оба направления</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={handleClear} className="mt-5">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Очистить
        </Button>
      </div>

      {points.length === 2 && (
        <p className="text-xs text-green-600">
          Линия задана. Нажмите «Сохранить» для применения.
        </p>
      )}
      {points.length === 1 && (
        <p className="text-xs text-yellow-600">
          Кликните вторую точку для завершения линии.
        </p>
      )}
    </div>
  );
}

function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  color: string
) {
  const headLen = 8;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

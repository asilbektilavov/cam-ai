'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';

interface HeatmapData {
  cameraId: string;
  cameraName: string;
  grid: number[][];
  gridWidth: number;
  gridHeight: number;
  hasData: boolean;
  totalRecordings: number;
  startedAt: number | null;
}

interface HeatmapOverlayProps {
  cameraId: string;
  className?: string;
  /** Width of the canvas in px (default 640) */
  width?: number;
  /** Height of the canvas in px (default 480) */
  height?: number;
  /** Show legend (default true) */
  showLegend?: boolean;
  /** Auto-refresh interval in ms (default 30000) */
  refreshInterval?: number;
}

/**
 * Map a normalized heatmap value (0-1) to an RGBA color.
 * Gradient: transparent -> blue -> green -> yellow -> red
 */
function valueToColor(value: number): [number, number, number, number] {
  if (value <= 0) return [0, 0, 0, 0];

  // Alpha scales with value (minimum 0.15 for visibility at low values)
  const alpha = Math.min(0.15 + value * 0.7, 0.85);

  let r: number, g: number, b: number;

  if (value < 0.25) {
    // Blue to cyan
    const t = value / 0.25;
    r = 0;
    g = Math.round(t * 200);
    b = 255;
  } else if (value < 0.5) {
    // Cyan to green
    const t = (value - 0.25) / 0.25;
    r = 0;
    g = 200 + Math.round(t * 55);
    b = Math.round(255 * (1 - t));
  } else if (value < 0.75) {
    // Green to yellow
    const t = (value - 0.5) / 0.25;
    r = Math.round(t * 255);
    g = 255;
    b = 0;
  } else {
    // Yellow to red
    const t = (value - 0.75) / 0.25;
    r = 255;
    g = Math.round(255 * (1 - t));
    b = 0;
  }

  return [r, g, b, Math.round(alpha * 255)];
}

export default function HeatmapOverlay({
  cameraId,
  className,
  width = 640,
  height = 480,
  showLegend = true,
  refreshInterval = 30000,
}: HeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HeatmapData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiGet<HeatmapData>(`/api/cameras/${cameraId}/heatmap`);
      setData(result);
      setError(null);
    } catch (err) {
      console.error('[Heatmap] Failed to fetch:', err);
      setError('Не удалось загрузить данные тепловой карты');
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  // Initial fetch + auto-refresh
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  // Render heatmap to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { grid, gridWidth, gridHeight } = data;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (!data.hasData) return;

    const cellWidth = width / gridWidth;
    const cellHeight = height / gridHeight;

    // Create an offscreen canvas for the raw heatmap
    const offscreen = document.createElement('canvas');
    offscreen.width = gridWidth;
    offscreen.height = gridHeight;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const imageData = offCtx.createImageData(gridWidth, gridHeight);

    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const value = grid[row]?.[col] ?? 0;
        const [r, g, b, a] = valueToColor(value);
        const idx = (row * gridWidth + col) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = a;
      }
    }

    offCtx.putImageData(imageData, 0, 0);

    // Draw the offscreen canvas scaled up with smooth interpolation
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, width, height);

    // Apply additional gaussian-like blur by re-drawing with alpha
    ctx.globalAlpha = 0.6;
    ctx.filter = 'blur(8px)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0;

    // Redraw crisp on top
    ctx.drawImage(offscreen, 0, 0, width, height);
  }, [data, width, height]);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center h-48', className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center h-48 text-muted-foreground text-sm', className)}>
        {error}
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-auto rounded-lg"
        style={{ imageRendering: 'auto' }}
      />

      {!data?.hasData && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm bg-muted/50 rounded-lg">
          Нет данных тепловой карты
        </div>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-muted-foreground">Низкая</span>
          <div
            className="flex-1 h-3 rounded-full"
            style={{
              background:
                'linear-gradient(to right, rgba(0,0,255,0.5), rgba(0,255,200,0.6), rgba(0,255,0,0.7), rgba(255,255,0,0.8), rgba(255,0,0,0.9))',
            }}
          />
          <span className="text-xs text-muted-foreground">Высокая</span>
        </div>
      )}

      {data?.hasData && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground">
            Записей: {data.totalRecordings}
          </span>
          {data.startedAt && (
            <span className="text-xs text-muted-foreground">
              С {new Date(data.startedAt).toLocaleString('ru-RU')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

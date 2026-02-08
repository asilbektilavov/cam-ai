'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin,
  RotateCcw,
  Download,
  Loader2,
  Camera,
  Clock,
  Maximize2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { apiGet, apiDelete } from '@/lib/api-client';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';

interface CameraInfo {
  id: string;
  name: string;
  location: string;
  status: string;
}

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

const TIME_RANGES = [
  { value: 'hour', label: 'Последний час' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Эта неделя' },
  { value: 'month', label: 'Этот месяц' },
] as const;

/**
 * Map a normalized value (0-1) to RGBA for the heatmap.
 * Gradient: transparent -> blue -> green -> yellow -> red
 */
function valueToColor(value: number): [number, number, number, number] {
  if (value <= 0) return [0, 0, 0, 0];

  const alpha = Math.min(0.2 + value * 0.65, 0.85);
  let r: number, g: number, b: number;

  if (value < 0.25) {
    const t = value / 0.25;
    r = 0;
    g = Math.round(t * 200);
    b = 255;
  } else if (value < 0.5) {
    const t = (value - 0.25) / 0.25;
    r = 0;
    g = 200 + Math.round(t * 55);
    b = Math.round(255 * (1 - t));
  } else if (value < 0.75) {
    const t = (value - 0.5) / 0.25;
    r = Math.round(t * 255);
    g = 255;
    b = 0;
  } else {
    const t = (value - 0.75) / 0.25;
    r = 255;
    g = Math.round(255 * (1 - t));
    b = 0;
  }

  return [r, g, b, Math.round(alpha * 255)];
}

export default function AnalyticsHeatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [timeRange, setTimeRange] = useState<string>('today');
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { selectedBranchId } = useAppStore();

  // Fetch cameras list
  useEffect(() => {
    async function loadCameras() {
      try {
        const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
        const result = await apiGet<CameraInfo[]>(`/api/cameras${branchParam}`);
        setCameras(result);
        if (result.length > 0 && !selectedCameraId) {
          setSelectedCameraId(result[0].id);
        }
      } catch (err) {
        console.error('[AnalyticsHeatmap] Failed to fetch cameras:', err);
        toast.error('Не удалось загрузить список камер');
      } finally {
        setLoading(false);
      }
    }

    loadCameras();
  }, [selectedBranchId, selectedCameraId]);

  // Fetch heatmap data for selected camera
  const fetchHeatmap = useCallback(async () => {
    if (!selectedCameraId) return;

    setHeatmapLoading(true);
    try {
      const data = await apiGet<HeatmapData>(`/api/cameras/${selectedCameraId}/heatmap`);
      setHeatmapData(data);
    } catch (err) {
      console.error('[AnalyticsHeatmap] Failed to fetch heatmap:', err);
      toast.error('Не удалось загрузить тепловую карту');
    } finally {
      setHeatmapLoading(false);
    }
  }, [selectedCameraId]);

  useEffect(() => {
    fetchHeatmap();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchHeatmap, 30000);
    return () => clearInterval(interval);
  }, [fetchHeatmap]);

  // Render heatmap canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmapData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { grid, gridWidth, gridHeight } = heatmapData;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Clear canvas with dark background
    ctx.fillStyle = 'rgba(15, 15, 20, 0.9)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (!heatmapData.hasData) {
      // Draw "no data" message
      ctx.fillStyle = 'rgba(150, 150, 160, 0.8)';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Нет данных тепловой карты', canvasWidth / 2, canvasHeight / 2);
      return;
    }

    // Create offscreen canvas for raw pixel data
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

    // Draw scaled heatmap with smooth interpolation
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, canvasWidth, canvasHeight);

    // Add a smoothing pass
    ctx.globalAlpha = 0.5;
    ctx.filter = 'blur(12px)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0;

    // Redraw crisp layer on top
    ctx.drawImage(offscreen, 0, 0, canvasWidth, canvasHeight);

    // Draw grid lines (subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;
    const cellW = canvasWidth / gridWidth;
    const cellH = canvasHeight / gridHeight;

    for (let col = 1; col < gridWidth; col++) {
      ctx.beginPath();
      ctx.moveTo(col * cellW, 0);
      ctx.lineTo(col * cellW, canvasHeight);
      ctx.stroke();
    }
    for (let row = 1; row < gridHeight; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * cellH);
      ctx.lineTo(canvasWidth, row * cellH);
      ctx.stroke();
    }
  }, [heatmapData]);

  // Reset heatmap for selected camera
  const handleReset = async () => {
    if (!selectedCameraId) return;

    try {
      await apiDelete(`/api/cameras/${selectedCameraId}/heatmap`);
      toast.success('Тепловая карта сброшена');
      fetchHeatmap();
    } catch (err) {
      console.error('[AnalyticsHeatmap] Failed to reset:', err);
      toast.error('Не удалось сбросить тепловую карту');
    }
  };

  // Export heatmap as PNG
  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a new canvas with legend
    const exportCanvas = document.createElement('canvas');
    const padding = 60;
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + padding;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return;

    // Background
    exportCtx.fillStyle = '#0f0f14';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Copy heatmap
    exportCtx.drawImage(canvas, 0, 0);

    // Draw legend at the bottom
    const legendY = canvas.height + 10;
    const legendWidth = exportCanvas.width - 80;
    const legendHeight = 16;
    const legendX = 40;

    // Gradient bar
    const gradient = exportCtx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 255, 0.7)');
    gradient.addColorStop(0.25, 'rgba(0, 200, 255, 0.7)');
    gradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.7)');
    gradient.addColorStop(0.75, 'rgba(255, 255, 0, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 0, 0, 0.9)');
    exportCtx.fillStyle = gradient;
    exportCtx.fillRect(legendX, legendY, legendWidth, legendHeight);

    // Legend labels
    exportCtx.fillStyle = '#999';
    exportCtx.font = '11px system-ui, sans-serif';
    exportCtx.textAlign = 'left';
    exportCtx.fillText('Низкая', legendX, legendY + legendHeight + 16);
    exportCtx.textAlign = 'right';
    exportCtx.fillText('Высокая', legendX + legendWidth, legendY + legendHeight + 16);
    exportCtx.textAlign = 'center';
    exportCtx.fillText('Активность', legendX + legendWidth / 2, legendY + legendHeight + 16);

    const link = document.createElement('a');
    const cameraName = heatmapData?.cameraName || 'camera';
    link.download = `heatmap-${cameraName}-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('Тепловая карта экспортирована');
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!isFullscreen) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (cameras.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Нет доступных камер</p>
          <p className="text-sm text-muted-foreground mt-1">
            Добавьте камеры для просмотра тепловой карты
          </p>
        </CardContent>
      </Card>
    );
  }

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Тепловая карта
        </CardTitle>
        <CardDescription>
          Визуализация зон активности по данным AI-анализа
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Camera selector */}
          <div className="flex items-center gap-2 flex-1">
            <Camera className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Выберите камеру" />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((cam) => (
                  <SelectItem key={cam.id} value={cam.id}>
                    {cam.name}
                    {cam.location ? ` (${cam.location})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time range selector */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGES.map((range) => (
                  <SelectItem key={range.value} value={range.value}>
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} title="Сбросить">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} title="Экспорт PNG">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={toggleFullscreen} title="Полный экран">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Camera info badges */}
        {selectedCamera && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">
              <Camera className="h-3 w-3 mr-1" />
              {selectedCamera.name}
            </Badge>
            {selectedCamera.location && (
              <Badge variant="outline">
                <MapPin className="h-3 w-3 mr-1" />
                {selectedCamera.location}
              </Badge>
            )}
            {heatmapData?.hasData && (
              <Badge variant="outline" className="text-muted-foreground">
                Записей: {heatmapData.totalRecordings}
              </Badge>
            )}
          </div>
        )}

        {/* Heatmap canvas */}
        <div
          ref={containerRef}
          className={cn(
            'relative rounded-lg overflow-hidden bg-black/80',
            isFullscreen && 'flex items-center justify-center bg-black p-4'
          )}
        >
          {heatmapLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={960}
            height={720}
            className={cn(
              'w-full h-auto',
              isFullscreen && 'max-w-full max-h-full object-contain'
            )}
            style={{ imageRendering: 'auto' }}
          />
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">Низкая</span>
          <div
            className="flex-1 h-4 rounded-full"
            style={{
              background:
                'linear-gradient(to right, rgba(0,0,255,0.6), rgba(0,200,255,0.6), rgba(0,255,0,0.7), rgba(255,255,0,0.8), rgba(255,0,0,0.9))',
            }}
          />
          <span className="text-xs text-muted-foreground shrink-0">Высокая</span>
        </div>

        {/* Stats footer */}
        {heatmapData?.hasData && heatmapData.startedAt && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
            <span>
              Данные собираются с {new Date(heatmapData.startedAt).toLocaleString('ru-RU')}
            </span>
            <span>
              Обновление каждые 30 сек.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

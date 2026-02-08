'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Shield, Trash2, Plus, Save, Eye, EyeOff, MousePointer, Square } from 'lucide-react';
import { toast } from 'sonner';

interface MaskZone {
  id: string;
  name: string;
  type: 'blur' | 'black';
  // Normalized coordinates (0-1)
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PrivacyMaskEditorProps {
  cameraId: string;
  cameraName: string;
  initialMasks?: MaskZone[];
  snapshotUrl?: string;
  onSave: (masks: MaskZone[]) => void;
}

export function PrivacyMaskEditor({
  cameraName,
  initialMasks = [],
  snapshotUrl,
  onSave,
}: PrivacyMaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [masks, setMasks] = useState<MaskZone[]>(initialMasks);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentDraw, setCurrentDraw] = useState<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [maskType, setMaskType] = useState<'blur' | 'black'>('blur');
  const [showMasks, setShowMasks] = useState(true);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  // Load background image
  useEffect(() => {
    if (!snapshotUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setBgImage(img);
    img.src = snapshotUrl;
  }, [snapshotUrl]);

  // Render canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#666';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Нет снимка камеры', w / 2, h / 2);
    }

    if (!showMasks) return;

    // Draw masks
    for (const mask of masks) {
      const mx = mask.x * w;
      const my = mask.y * h;
      const mw = mask.width * w;
      const mh = mask.height * h;

      if (mask.type === 'black') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(mx, my, mw, mh);
      } else {
        // Blur effect via multiple semi-transparent layers
        ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
        ctx.fillRect(mx, my, mw, mh);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = `rgba(200, 200, 200, ${0.15 + i * 0.05})`;
          ctx.fillRect(mx + i, my + i, mw - i * 2, mh - i * 2);
        }
      }

      // Border
      const isSelected = mask.id === selectedMaskId;
      ctx.strokeStyle = isSelected ? '#3b82f6' : '#ef4444';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.setLineDash(isSelected ? [6, 3] : []);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = isSelected ? '#3b82f6' : '#ef4444';
      ctx.fillRect(mx, my - 20, Math.min(ctx.measureText(mask.name).width + 10, mw), 20);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(mask.name, mx + 4, my - 6);
    }

    // Current drawing rect
    if (isDrawing && drawStart && currentDraw) {
      const sx = drawStart.x * w;
      const sy = drawStart.y * h;
      const ex = currentDraw.x * w;
      const ey = currentDraw.y * h;
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx, sy, ex - sx, ey - sy);
      ctx.setLineDash([]);
    }
  }, [masks, selectedMaskId, isDrawing, drawStart, currentDraw, showMasks, bgImage]);

  useEffect(() => {
    render();
  }, [render]);

  // Resize canvas
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.width * 9 / 16; // 16:9
      render();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [render]);

  const getCanvasCoords = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / canvas.width,
      y: (e.clientY - rect.top) / canvas.height,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasCoords(e);

    if (tool === 'select') {
      // Check if clicking on a mask
      const canvas = canvasRef.current;
      if (!canvas) return;
      const clicked = masks.find(
        (m) =>
          pos.x >= m.x &&
          pos.x <= m.x + m.width &&
          pos.y >= m.y &&
          pos.y <= m.y + m.height
      );
      setSelectedMaskId(clicked?.id || null);
    } else {
      setIsDrawing(true);
      setDrawStart(pos);
      setCurrentDraw(pos);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    setCurrentDraw(getCanvasCoords(e));
  };

  const handleMouseUp = () => {
    if (!isDrawing || !drawStart || !currentDraw) {
      setIsDrawing(false);
      return;
    }

    const x = Math.min(drawStart.x, currentDraw.x);
    const y = Math.min(drawStart.y, currentDraw.y);
    const width = Math.abs(currentDraw.x - drawStart.x);
    const height = Math.abs(currentDraw.y - drawStart.y);

    if (width > 0.01 && height > 0.01) {
      const newMask: MaskZone = {
        id: `mask_${Date.now()}`,
        name: `Зона ${masks.length + 1}`,
        type: maskType,
        x,
        y,
        width,
        height,
      };
      setMasks((prev) => [...prev, newMask]);
      setSelectedMaskId(newMask.id);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentDraw(null);
  };

  const deleteMask = (id: string) => {
    setMasks((prev) => prev.filter((m) => m.id !== id));
    if (selectedMaskId === id) setSelectedMaskId(null);
  };

  const updateMaskName = (id: string, name: string) => {
    setMasks((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)));
  };

  const updateMaskType = (id: string, type: 'blur' | 'black') => {
    setMasks((prev) => prev.map((m) => (m.id === id ? { ...m, type } : m)));
  };

  const handleSave = () => {
    onSave(masks);
    toast.success('Маски приватности сохранены');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Canvas area */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {cameraName} — маскирование
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={tool === 'select' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTool('select')}
              >
                <MousePointer className="h-4 w-4" />
              </Button>
              <Button
                variant={tool === 'draw' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTool('draw')}
              >
                <Square className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMasks(!showMasks)}
              >
                {showMasks ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div ref={containerRef} className="relative w-full">
            <canvas
              ref={canvasRef}
              className={cn(
                'w-full rounded-b-lg',
                tool === 'draw' ? 'cursor-crosshair' : 'cursor-default'
              )}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                if (isDrawing) handleMouseUp();
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Mask list panel */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Зоны маскирования</CardTitle>
              <Badge variant="secondary">{masks.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {/* Drawing options */}
            <div className="flex items-center gap-2 pb-2 border-b border-border">
              <span className="text-xs text-muted-foreground">Тип маски:</span>
              <Select value={maskType} onValueChange={(v) => setMaskType(v as 'blur' | 'black')}>
                <SelectTrigger className="h-7 text-xs w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blur">Размытие</SelectItem>
                  <SelectItem value="black">Чёрный</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {masks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Используйте инструмент <Square className="inline h-3 w-3" /> для рисования зон маскирования
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {masks.map((mask) => (
                  <div
                    key={mask.id}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                      mask.id === selectedMaskId
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-border hover:bg-accent'
                    )}
                    onClick={() => setSelectedMaskId(mask.id)}
                  >
                    <div
                      className={cn(
                        'h-3 w-3 rounded-sm shrink-0',
                        mask.type === 'black' ? 'bg-black border' : 'bg-gray-400'
                      )}
                    />
                    <Input
                      value={mask.name}
                      onChange={(e) => updateMaskName(mask.id, e.target.value)}
                      className="h-6 text-xs flex-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Select
                      value={mask.type}
                      onValueChange={(v) => updateMaskType(mask.id, v as 'blur' | 'black')}
                    >
                      <SelectTrigger className="h-6 text-[10px] w-20" onClick={(e) => e.stopPropagation()}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blur">Blur</SelectItem>
                        <SelectItem value="black">Black</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMask(mask.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-border">
              <Button size="sm" className="flex-1 gap-1" onClick={handleSave}>
                <Save className="h-3 w-3" />
                Сохранить
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Подсказка:</strong> Выберите инструмент рисования (□), затем нарисуйте прямоугольник на кадре камеры.
              Замаскированные зоны будут скрыты при просмотре и записи.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

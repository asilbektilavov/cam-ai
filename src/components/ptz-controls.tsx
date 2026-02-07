'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiPost, apiGet } from '@/lib/api-client';
import { toast } from 'sonner';

interface PtzControlsProps {
  cameraId: string;
  hasPtz: boolean;
  className?: string;
}

interface PtzPreset {
  id: string;
  name: string;
}

type PtzDirection = 'up' | 'down' | 'left' | 'right';
type PtzZoom = 'in' | 'out';

export function PtzControls({ cameraId, hasPtz, className }: PtzControlsProps) {
  const [speed, setSpeed] = useState(5);
  const [presets, setPresets] = useState<PtzPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [isMoving, setIsMoving] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const activeActionRef = useRef<string | null>(null);

  // Fetch presets on mount
  useEffect(() => {
    if (!hasPtz) return;
    const fetchPresets = async () => {
      setLoadingPresets(true);
      try {
        const data = await apiGet<{ presets: PtzPreset[] }>(
          `/api/cameras/${cameraId}/ptz`
        );
        setPresets(data.presets || []);
      } catch {
        // Presets may not be available
      } finally {
        setLoadingPresets(false);
      }
    };
    fetchPresets();
  }, [cameraId, hasPtz]);

  const sendPtzCommand = useCallback(
    async (action: string, params?: Record<string, unknown>) => {
      try {
        await apiPost(`/api/cameras/${cameraId}/ptz`, {
          action,
          speed,
          ...params,
        });
      } catch {
        toast.error('Ошибка PTZ команды');
      }
    },
    [cameraId, speed]
  );

  // Hold-to-move: start moving on mousedown, stop on mouseup
  const handleMoveStart = useCallback(
    (direction: PtzDirection) => {
      if (!hasPtz) return;
      activeActionRef.current = direction;
      setIsMoving(true);
      sendPtzCommand('move', { direction });
    },
    [hasPtz, sendPtzCommand]
  );

  const handleMoveStop = useCallback(() => {
    if (activeActionRef.current) {
      activeActionRef.current = null;
      setIsMoving(false);
      sendPtzCommand('move', { direction: 'stop' });
    }
  }, [sendPtzCommand]);

  const handleZoomStart = useCallback(
    (direction: PtzZoom) => {
      if (!hasPtz) return;
      activeActionRef.current = `zoom-${direction}`;
      setIsMoving(true);
      sendPtzCommand('move', { direction: direction === 'in' ? 'zoomIn' : 'zoomOut' });
    },
    [hasPtz, sendPtzCommand]
  );

  const handleZoomStop = useCallback(() => {
    if (activeActionRef.current) {
      activeActionRef.current = null;
      setIsMoving(false);
      sendPtzCommand('move', { direction: 'stop' });
    }
  }, [sendPtzCommand]);

  const handlePresetGo = useCallback(
    (presetId: string) => {
      if (!hasPtz || !presetId) return;
      sendPtzCommand('preset', { presetToken: presetId });
      toast.success('Переход к позиции');
    },
    [hasPtz, sendPtzCommand]
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!hasPtz) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if no input is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          handleMoveStart('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleMoveStart('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleMoveStart('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleMoveStart('right');
          break;
        case '+':
        case '=':
          e.preventDefault();
          handleZoomStart('in');
          break;
        case '-':
          e.preventDefault();
          handleZoomStart('out');
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          handleMoveStop();
          break;
        case '+':
        case '=':
        case '-':
          handleZoomStop();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [hasPtz, handleMoveStart, handleMoveStop, handleZoomStart, handleZoomStop]);

  // Global mouseup to stop movement if mouse leaves button
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (activeActionRef.current) {
        handleMoveStop();
        handleZoomStop();
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleMoveStop, handleZoomStop]);

  if (!hasPtz) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Crosshair className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              PTZ управление недоступно для этой камеры
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const DirectionButton = ({
    direction,
    icon: Icon,
    gridClass,
  }: {
    direction: PtzDirection;
    icon: typeof ChevronUp;
    gridClass: string;
  }) => (
    <Button
      variant="outline"
      size="icon"
      className={cn('h-10 w-10', gridClass)}
      onMouseDown={() => handleMoveStart(direction)}
      onMouseUp={handleMoveStop}
      onMouseLeave={handleMoveStop}
      onTouchStart={() => handleMoveStart(direction)}
      onTouchEnd={handleMoveStop}
    >
      <Icon className="h-5 w-5" />
    </Button>
  );

  return (
    <Card className={className}>
      <CardHeader className="pb-3 px-4 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Crosshair className="h-4 w-4" />
          PTZ управление
          {isMoving && (
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* D-Pad */}
        <div className="flex justify-center">
          <div className="grid grid-cols-3 grid-rows-3 gap-1 w-fit">
            {/* Row 1 */}
            <div />
            <DirectionButton
              direction="up"
              icon={ChevronUp}
              gridClass=""
            />
            <div />

            {/* Row 2 */}
            <DirectionButton
              direction="left"
              icon={ChevronLeft}
              gridClass=""
            />
            <div className="flex items-center justify-center">
              <div className="h-10 w-10 rounded-md border border-dashed border-muted-foreground/30 flex items-center justify-center">
                <Crosshair className="h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>
            <DirectionButton
              direction="right"
              icon={ChevronRight}
              gridClass=""
            />

            {/* Row 3 */}
            <div />
            <DirectionButton
              direction="down"
              icon={ChevronDown}
              gridClass=""
            />
            <div />
          </div>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onMouseDown={() => handleZoomStart('out')}
            onMouseUp={handleZoomStop}
            onMouseLeave={handleZoomStop}
            onTouchStart={() => handleZoomStart('out')}
            onTouchEnd={handleZoomStop}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">Зум</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onMouseDown={() => handleZoomStart('in')}
            onMouseUp={handleZoomStop}
            onMouseLeave={handleZoomStop}
            onTouchStart={() => handleZoomStart('in')}
            onTouchEnd={handleZoomStop}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        {/* Speed slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Скорость</span>
            <span className="text-xs font-medium">{speed}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={speed}
            onChange={(e) => setSpeed(parseInt(e.target.value))}
            className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>1</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        {/* Presets */}
        {loadingPresets ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : presets.length > 0 ? (
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Позиции</span>
            <div className="flex gap-2">
              <Select
                value={selectedPreset}
                onValueChange={setSelectedPreset}
              >
                <SelectTrigger className="flex-1 h-8">
                  <SelectValue placeholder="Выберите позицию" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePresetGo(selectedPreset)}
                disabled={!selectedPreset}
              >
                Перейти
              </Button>
            </div>
          </div>
        ) : null}

        {/* Keyboard shortcuts hint */}
        <p className="text-[10px] text-muted-foreground text-center">
          Стрелки — направление &middot; +/- — зум
        </p>
      </CardContent>
    </Card>
  );
}

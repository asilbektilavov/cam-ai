'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutGrid,
  Maximize,
  Minimize,
  Save,
  FolderOpen,
  Trash2,
  X,
  Plus,
  Loader2,
  Monitor,
  Grid2x2,
  Grid3x3,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { DetectionVideoPlayer } from '@/components/detection-video-player';
import { useAppStore } from '@/lib/store';

// --- Types ---

interface ApiCamera {
  id: string;
  name: string;
  location: string;
  streamUrl: string;
  status: string;
  resolution: string;
  fps: number;
}

interface SlotData {
  position: number;
  cameraId: string;
}

interface WallLayout {
  id: string;
  name: string;
  grid: string;
  slots: string; // JSON stringified SlotData[]
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

type GridOption = '1x1' | '2x2' | '3x3' | '4x4';

const GRID_OPTIONS: { value: GridOption; label: string; cols: number }[] = [
  { value: '1x1', label: '1x1', cols: 1 },
  { value: '2x2', label: '2x2', cols: 2 },
  { value: '3x3', label: '3x3', cols: 3 },
  { value: '4x4', label: '4x4', cols: 4 },
];

function getGridCols(grid: GridOption): number {
  const option = GRID_OPTIONS.find((g) => g.value === grid);
  return option?.cols ?? 2;
}

function getTotalSlots(grid: GridOption): number {
  const cols = getGridCols(grid);
  return cols * cols;
}

// --- Component ---

export default function VideoWallPage() {
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [layouts, setLayouts] = useState<WallLayout[]>([]);
  const [loading, setLoading] = useState(true);

  const [grid, setGrid] = useState<GridOption>('2x2');
  const [slots, setSlots] = useState<(string | null)[]>(Array(4).fill(null));
  const [layoutName, setLayoutName] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [deletingLayoutId, setDeletingLayoutId] = useState<string | null>(null);

  const wallRef = useRef<HTMLDivElement>(null);
  const { selectedBranchId } = useAppStore();

  // --- Data Fetching ---

  const fetchCameras = useCallback(async () => {
    try {
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const data = await apiGet<ApiCamera[]>(`/api/cameras${branchParam}`);
      setCameras(data);
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    }
  }, [selectedBranchId]);

  const fetchLayouts = useCallback(async () => {
    try {
      const data = await apiGet<WallLayout[]>('/api/wall-layouts');
      setLayouts(data);
    } catch (err) {
      console.error('Failed to fetch layouts:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchCameras(), fetchLayouts()]).finally(() => setLoading(false));
  }, [fetchCameras, fetchLayouts]);

  // --- Grid Change ---

  const handleGridChange = (newGrid: GridOption) => {
    const total = getTotalSlots(newGrid);
    setGrid(newGrid);
    setSlots((prev) => {
      const next = Array(total).fill(null);
      for (let i = 0; i < Math.min(prev.length, total); i++) {
        next[i] = prev[i];
      }
      return next;
    });
    setSelectedLayoutId(null);
  };

  // --- Slot Management ---

  const assignCamera = (position: number, cameraId: string) => {
    setSlots((prev) => {
      const next = [...prev];
      // Remove camera from other slot if already assigned
      const existingIdx = next.indexOf(cameraId);
      if (existingIdx !== -1) {
        next[existingIdx] = null;
      }
      next[position] = cameraId;
      return next;
    });
  };

  const removeCamera = (position: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[position] = null;
      return next;
    });
  };

  // --- Layout Save/Load ---

  const handleSave = async () => {
    if (!layoutName.trim()) {
      toast.error('Введите название раскладки');
      return;
    }

    setSavingLayout(true);
    try {
      const slotsData: SlotData[] = slots
        .map((cameraId, position) =>
          cameraId ? { position, cameraId } : null
        )
        .filter(Boolean) as SlotData[];

      if (selectedLayoutId) {
        await apiPatch(`/api/wall-layouts/${selectedLayoutId}`, {
          name: layoutName,
          grid,
          slots: JSON.stringify(slotsData),
        });
        toast.success('Раскладка обновлена');
      } else {
        const created = await apiPost<WallLayout>('/api/wall-layouts', {
          name: layoutName,
          grid,
          slots: JSON.stringify(slotsData),
        });
        setSelectedLayoutId(created.id);
        toast.success('Раскладка сохранена');
      }
      fetchLayouts();
    } catch {
      toast.error('Не удалось сохранить раскладку');
    } finally {
      setSavingLayout(false);
    }
  };

  const handleLoadLayout = (layout: WallLayout) => {
    const parsedSlots: SlotData[] = JSON.parse(layout.slots || '[]');
    const gridValue = layout.grid as GridOption;
    const total = getTotalSlots(gridValue);
    const newSlots = Array(total).fill(null);

    for (const slot of parsedSlots) {
      if (slot.position < total) {
        newSlots[slot.position] = slot.cameraId;
      }
    }

    setGrid(gridValue);
    setSlots(newSlots);
    setLayoutName(layout.name);
    setSelectedLayoutId(layout.id);
    setLoadDialogOpen(false);
    toast.success(`Раскладка "${layout.name}" загружена`);
  };

  const handleDeleteLayout = async (id: string) => {
    setDeletingLayoutId(id);
    try {
      await apiDelete(`/api/wall-layouts/${id}`);
      toast.success('Раскладка удалена');
      if (selectedLayoutId === id) {
        setSelectedLayoutId(null);
        setLayoutName('');
      }
      fetchLayouts();
    } catch {
      toast.error('Не удалось удалить раскладку');
    } finally {
      setDeletingLayoutId(null);
    }
  };

  // --- Fullscreen ---

  const toggleFullscreen = async () => {
    if (!wallRef.current) return;

    if (!document.fullscreenElement) {
      try {
        await wallRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        toast.error('Не удалось перейти в полноэкранный режим');
      }
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // --- Helpers ---

  const getCameraById = (id: string) => cameras.find((c) => c.id === id);

  const getAvailableCameras = (excludePosition?: number) => {
    const assignedIds = new Set(
      slots.filter((s, i) => s && i !== excludePosition)
    );
    return cameras.filter((c) => !assignedIds.has(c.id));
  };

  const cols = getGridCols(grid);
  const totalSlots = getTotalSlots(grid);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Видеостена</h1>
          <p className="text-muted-foreground">
            Просмотр камер в режиме мультиэкрана
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Grid selector */}
          {GRID_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={grid === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleGridChange(opt.value)}
              className="gap-1.5"
            >
              {opt.value === '1x1' && <Monitor className="h-4 w-4" />}
              {opt.value === '2x2' && <Grid2x2 className="h-4 w-4" />}
              {opt.value === '3x3' && <Grid3x3 className="h-4 w-4" />}
              {opt.value === '4x4' && <LayoutGrid className="h-4 w-4" />}
              {opt.label}
            </Button>
          ))}

          {/* Fullscreen toggle */}
          <Button variant="outline" size="sm" onClick={toggleFullscreen}>
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Layout Save/Load Bar */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4">
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <Input
              placeholder="Название раскладки..."
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value)}
              className="flex-1 sm:max-w-[250px]"
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={savingLayout}
              className="gap-1.5 shrink-0"
            >
              {savingLayout ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Сохранить
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setLoadDialogOpen(true)}
            className="gap-1.5"
          >
            <FolderOpen className="h-4 w-4" />
            Загрузить
          </Button>

          {selectedLayoutId && (
            <Badge variant="secondary" className="text-xs">
              Раскладка: {layoutName || 'Без названия'}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Video Wall Grid */}
      <div
        ref={wallRef}
        className={cn(
          'bg-background rounded-lg',
          isFullscreen && 'p-4 bg-black'
        )}
      >
        <div
          className={cn(
            'grid gap-2',
            // Responsive: on mobile always 1 column
            'grid-cols-1',
            cols === 1 && 'md:grid-cols-1',
            cols === 2 && 'md:grid-cols-2',
            cols === 3 && 'md:grid-cols-3',
            cols === 4 && 'md:grid-cols-4'
          )}
        >
          {Array.from({ length: totalSlots }).map((_, position) => {
            const cameraId = slots[position] ?? null;
            const camera = cameraId ? getCameraById(cameraId) : null;

            return (
              <WallSlot
                key={`${grid}-${position}`}
                position={position}
                camera={camera ?? undefined}
                cameraId={cameraId}
                availableCameras={getAvailableCameras(position)}
                onAssign={(camId) => assignCamera(position, camId)}
                onRemove={() => removeCamera(position)}
                isFullscreen={isFullscreen}
              />
            );
          })}
        </div>
      </div>

      {/* Load Layout Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Загрузить раскладку</DialogTitle>
            <DialogDescription>
              Выберите сохранённую раскладку видеостены
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {layouts.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-center">
                <FolderOpen className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Нет сохранённых раскладок
                </p>
                <p className="text-xs text-muted-foreground">
                  Настройте видеостену и сохраните раскладку
                </p>
              </div>
            ) : (
              layouts.map((layout) => {
                const parsedSlots: SlotData[] = JSON.parse(layout.slots || '[]');
                return (
                  <div
                    key={layout.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                  >
                    <button
                      onClick={() => handleLoadLayout(layout)}
                      className="flex-1 text-left"
                    >
                      <p className="font-medium text-sm">{layout.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px]">
                          {layout.grid}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {parsedSlots.length} камер
                        </span>
                        {layout.isDefault && (
                          <Badge variant="secondary" className="text-[10px]">
                            По умолчанию
                          </Badge>
                        )}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteLayout(layout.id)}
                      disabled={deletingLayoutId === layout.id}
                    >
                      {deletingLayoutId === layout.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Wall Slot Component ---

interface WallSlotProps {
  position: number;
  camera: ApiCamera | undefined;
  cameraId: string | null;
  availableCameras: ApiCamera[];
  onAssign: (cameraId: string) => void;
  onRemove: () => void;
  isFullscreen: boolean;
}

function WallSlot({
  position,
  camera,
  cameraId,
  availableCameras,
  onAssign,
  onRemove,
  isFullscreen,
}: WallSlotProps) {
  const [selectOpen, setSelectOpen] = useState(false);

  if (!cameraId || !camera) {
    // Empty slot
    return (
      <div
        className={cn(
          'relative aspect-video rounded-lg border-2 border-dashed border-muted-foreground/20',
          'bg-muted/30 flex flex-col items-center justify-center gap-2',
          'transition-colors hover:border-muted-foreground/40 hover:bg-muted/50'
        )}
      >
        <DropdownMenu open={selectOpen} onOpenChange={setSelectOpen}>
          <DropdownMenuTrigger asChild>
            <button className="flex flex-col items-center gap-2 p-4">
              <Plus className="h-8 w-8 text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground">
                Выбрать камеру
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-64 max-h-60 overflow-y-auto">
            {availableCameras.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Нет доступных камер
                </p>
              </div>
            ) : (
              availableCameras.map((cam) => (
                <DropdownMenuItem
                  key={cam.id}
                  onClick={() => {
                    onAssign(cam.id);
                    setSelectOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <div className="flex items-center gap-2 w-full">
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        cam.status === 'online' ? 'bg-green-500' : 'bg-red-500'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cam.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {cam.location}
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="absolute bottom-2 left-2 text-[10px] text-muted-foreground/40 font-mono">
          #{position + 1}
        </span>
      </div>
    );
  }

  // Occupied slot with video player
  return (
    <div
      className="relative aspect-video rounded-lg overflow-hidden bg-black group"
      onContextMenu={(e) => {
        e.preventDefault();
        onRemove();
      }}
    >
      <DetectionVideoPlayer
        src={`/api/cameras/${cameraId}/stream`}
        cameraId={cameraId}
        live={true}
        autoPlay={true}
        muted={true}
        controls={false}
        className="h-full w-full"
      />

      {/* Camera name overlay */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                camera.status === 'online' ? 'bg-green-500' : 'bg-red-500'
              )}
            />
            <span className="text-[11px] text-white font-medium truncate max-w-[80%]">
              {camera.name}
            </span>
          </div>
          <span className="text-[10px] text-white/60 font-mono">
            #{position + 1}
          </span>
        </div>
      </div>

      {/* Remove button - visible on hover */}
      <button
        onClick={onRemove}
        className={cn(
          'absolute top-2 right-2 z-20',
          'h-6 w-6 rounded-full bg-black/60 flex items-center justify-center',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:bg-red-600'
        )}
      >
        <X className="h-3.5 w-3.5 text-white" />
      </button>
    </div>
  );
}

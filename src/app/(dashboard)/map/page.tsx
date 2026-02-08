'use client';

import { useState, useEffect, useCallback, useRef, type DragEvent, type MouseEvent } from 'react';
import {
  Map,
  Camera,
  Upload,
  Edit,
  Trash2,
  Eye,
  Plus,
  Save,
  Loader2,
  X,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Move,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiDelete } from '@/lib/api-client';
import { VideoPlayer } from '@/components/video-player';
import { useAppStore } from '@/lib/store';

// ---- Types ----

interface ApiCamera {
  id: string;
  name: string;
  location: string;
  streamUrl: string;
  status: string;
  venueType: string;
  resolution: string;
  fps: number;
  isMonitoring: boolean;
}

interface CameraPlacement {
  cameraId: string;
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
  rotation: number;
}

interface FloorPlan {
  id: string;
  name: string;
  imagePath: string;
  cameras: string; // JSON string
  width: number;
  height: number;
  branchId: string | null;
  createdAt: string;
}

// ---- Component ----

export default function MapPage() {
  // Data
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [placements, setPlacements] = useState<CameraPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // UI State
  const [editMode, setEditMode] = useState(false);
  const [draggingCameraId, setDraggingCameraId] = useState<string | null>(null);
  const [draggingPlacementIdx, setDraggingPlacementIdx] = useState<number | null>(null);
  const [selectedPlacementIdx, setSelectedPlacementIdx] = useState<number | null>(null);
  const [previewCamera, setPreviewCamera] = useState<ApiCamera | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Upload
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { selectedBranchId } = useAppStore();

  // ---- Data Fetching ----

  const fetchFloorPlans = useCallback(async () => {
    try {
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const data = await apiGet<FloorPlan[]>(`/api/floor-plans${branchParam}`);
      setFloorPlans(data);
      if (data.length > 0 && !selectedPlanId) {
        setSelectedPlanId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch floor plans:', err);
    }
  }, [selectedBranchId, selectedPlanId]);

  const fetchCameras = useCallback(async () => {
    try {
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const data = await apiGet<ApiCamera[]>(`/api/cameras${branchParam}`);
      setCameras(data);
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    Promise.all([fetchFloorPlans(), fetchCameras()]).finally(() => setLoading(false));
  }, [fetchFloorPlans, fetchCameras]);

  // Parse placements when selected plan changes
  const selectedPlan = floorPlans.find((p) => p.id === selectedPlanId) || null;

  useEffect(() => {
    if (selectedPlan) {
      try {
        const parsed = JSON.parse(selectedPlan.cameras);
        setPlacements(Array.isArray(parsed) ? parsed : []);
      } catch {
        setPlacements([]);
      }
    } else {
      setPlacements([]);
    }
    setSelectedPlacementIdx(null);
  }, [selectedPlan]);

  // ---- Floor Plan Upload ----

  const handleUpload = async () => {
    if (!uploadName.trim()) {
      toast.error('Укажите название плана');
      return;
    }
    if (!uploadFile) {
      toast.error('Выберите файл изображения');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('name', uploadName.trim());
      formData.append('image', uploadFile);
      if (selectedBranchId) {
        formData.append('branchId', selectedBranchId);
      }

      const res = await fetch('/api/floor-plans', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Ошибка загрузки' }));
        throw new Error(err.error || 'Ошибка загрузки');
      }

      const created = await res.json();
      toast.success(`План "${created.name}" создан`);
      setUploadDialogOpen(false);
      setUploadName('');
      setUploadFile(null);
      setSelectedPlanId(created.id);
      await fetchFloorPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить план');
    } finally {
      setUploading(false);
    }
  };

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setUploadFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
    }
  };

  // ---- Delete Floor Plan ----

  const handleDeletePlan = async () => {
    if (!deletingPlanId) return;
    try {
      await apiDelete(`/api/floor-plans/${deletingPlanId}`);
      toast.success('План удален');
      setDeleteDialogOpen(false);
      setDeletingPlanId(null);
      if (selectedPlanId === deletingPlanId) {
        setSelectedPlanId(null);
      }
      await fetchFloorPlans();
    } catch {
      toast.error('Не удалось удалить план');
    }
  };

  // ---- Save Placements ----

  const handleSave = async () => {
    if (!selectedPlanId) return;
    setSaving(true);
    try {
      await apiPatch(`/api/floor-plans/${selectedPlanId}`, { cameras: placements });
      toast.success('Расположение камер сохранено');
      // Update local state
      setFloorPlans((prev) =>
        prev.map((p) =>
          p.id === selectedPlanId ? { ...p, cameras: JSON.stringify(placements) } : p
        )
      );
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  // ---- Camera Drag from List ----

  const handleCameraDragStart = (cameraId: string) => {
    if (!editMode) return;
    setDraggingCameraId(cameraId);
  };

  const handleCanvasDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleCanvasDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!editMode || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / (rect.width * zoom);
    const y = (e.clientY - rect.top - pan.y) / (rect.height * zoom);

    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));

    if (draggingCameraId) {
      // Check if already placed
      const alreadyPlaced = placements.some((p) => p.cameraId === draggingCameraId);
      if (alreadyPlaced) {
        toast.error('Эта камера уже размещена на плане');
        setDraggingCameraId(null);
        return;
      }

      setPlacements((prev) => [
        ...prev,
        { cameraId: draggingCameraId, x: clampedX, y: clampedY, rotation: 0 },
      ]);
      setDraggingCameraId(null);
    }
  };

  // ---- Placement Drag on Canvas ----

  const handlePlacementMouseDown = (e: MouseEvent, idx: number) => {
    if (!editMode) return;
    e.stopPropagation();
    e.preventDefault();
    setDraggingPlacementIdx(idx);
    setSelectedPlacementIdx(idx);
  };

  useEffect(() => {
    if (draggingPlacementIdx === null) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / (rect.width * zoom);
      const y = (e.clientY - rect.top - pan.y) / (rect.height * zoom);

      const clampedX = Math.max(0, Math.min(1, x));
      const clampedY = Math.max(0, Math.min(1, y));

      setPlacements((prev) =>
        prev.map((p, i) =>
          i === draggingPlacementIdx ? { ...p, x: clampedX, y: clampedY } : p
        )
      );
    };

    const handleMouseUp = () => {
      setDraggingPlacementIdx(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPlacementIdx, pan, zoom]);

  // ---- Pan & Zoom ----

  const handleCanvasMouseDown = (e: MouseEvent) => {
    // Only pan if not in edit mode or using middle mouse button
    if (e.button === 1 || (!editMode && e.button === 0)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => Math.max(0.3, Math.min(3, prev + delta)));
  };

  // ---- Placement Actions ----

  const handleRemovePlacement = (idx: number) => {
    setPlacements((prev) => prev.filter((_, i) => i !== idx));
    setSelectedPlacementIdx(null);
  };

  const handleRotatePlacement = (idx: number) => {
    setPlacements((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, rotation: (p.rotation + 45) % 360 } : p
      )
    );
  };

  const handleCameraClick = (placement: CameraPlacement) => {
    const cam = cameras.find((c) => c.id === placement.cameraId);
    if (cam) {
      setPreviewCamera(cam);
      setPreviewOpen(true);
    }
  };

  // ---- Helpers ----

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-green-500';
      case 'offline':
        return 'bg-red-500';
      default:
        return 'bg-yellow-500';
    }
  };

  const getStatusBorder = (status: string) => {
    switch (status) {
      case 'online':
        return 'border-green-500 shadow-green-500/30';
      case 'offline':
        return 'border-red-500 shadow-red-500/30';
      default:
        return 'border-yellow-500 shadow-yellow-500/30';
    }
  };

  const placedCameraIds = new Set(placements.map((p) => p.cameraId));
  const availableCameras = cameras.filter((c) => !placedCameraIds.has(c.id));

  // ---- Render ----

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Карта объекта</h1>
          <p className="text-muted-foreground">Интерактивный план с расположением камер</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Plan selector */}
          {floorPlans.length > 0 && (
            <Select
              value={selectedPlanId || ''}
              onValueChange={(v) => {
                setSelectedPlanId(v);
                setEditMode(false);
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Выберите план" />
              </SelectTrigger>
              <SelectContent>
                {floorPlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Edit toggle */}
          {selectedPlan && (
            <Button
              variant={editMode ? 'default' : 'outline'}
              className="gap-2"
              onClick={() => {
                setEditMode(!editMode);
                setSelectedPlacementIdx(null);
              }}
            >
              <Edit className="h-4 w-4" />
              {editMode ? 'Просмотр' : 'Редактировать'}
            </Button>
          )}

          {/* Save */}
          {editMode && selectedPlan && (
            <Button className="gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить
            </Button>
          )}

          {/* Delete plan */}
          {selectedPlan && (
            <Button
              variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                setDeletingPlanId(selectedPlan.id);
                setDeleteDialogOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}

          {/* Upload new plan */}
          <Button className="gap-2" onClick={() => setUploadDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Новый план
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {!selectedPlan ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Map className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет планов объекта</h3>
            <p className="text-muted-foreground mb-4">
              Загрузите план этажа или здания, чтобы разместить на нём камеры
            </p>
            <Button onClick={() => setUploadDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Загрузить план
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Canvas Area */}
          <div className="flex-1 min-w-0">
            {/* Zoom controls */}
            <div className="flex items-center gap-2 mb-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                Сбросить
              </Button>
              <span className="text-xs text-muted-foreground ml-2">
                {Math.round(zoom * 100)}%
              </span>
              {!editMode && (
                <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                  <Move className="h-3 w-3" />
                  Перетаскивайте для навигации
                </span>
              )}
            </div>

            <Card className="overflow-hidden">
              <div
                ref={canvasRef}
                className={cn(
                  'relative w-full overflow-hidden bg-muted/30',
                  editMode ? 'cursor-crosshair' : 'cursor-grab',
                  isPanning && 'cursor-grabbing'
                )}
                style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                onMouseDown={handleCanvasMouseDown}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Floor plan image + camera icons container */}
                <div
                  className="absolute inset-0 origin-top-left"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transition: draggingPlacementIdx !== null ? 'none' : undefined,
                  }}
                >
                  {/* Floor plan image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/floor-plans/${selectedPlan.id}/image`}
                    alt={selectedPlan.name}
                    className="w-full h-full object-contain pointer-events-none select-none"
                    draggable={false}
                  />

                  {/* Camera placements */}
                  {placements.map((placement, idx) => {
                    const cam = cameras.find((c) => c.id === placement.cameraId);
                    if (!cam) return null;
                    const isSelected = selectedPlacementIdx === idx;

                    return (
                      <div
                        key={`${placement.cameraId}-${idx}`}
                        className="absolute group"
                        style={{
                          left: `${placement.x * 100}%`,
                          top: `${placement.y * 100}%`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: isSelected ? 20 : 10,
                        }}
                      >
                        {/* Camera icon */}
                        <button
                          type="button"
                          className={cn(
                            'relative flex items-center justify-center w-10 h-10 rounded-full border-2 shadow-lg transition-all',
                            getStatusBorder(cam.status),
                            isSelected && 'ring-2 ring-primary ring-offset-2',
                            editMode && 'cursor-move'
                          )}
                          style={{
                            backgroundColor: 'var(--card)',
                            transform: `rotate(${placement.rotation}deg)`,
                          }}
                          onMouseDown={(e) => {
                            if (editMode) {
                              handlePlacementMouseDown(e, idx);
                            }
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!editMode) {
                              handleCameraClick(placement);
                            } else {
                              setSelectedPlacementIdx(idx);
                            }
                          }}
                        >
                          <Camera
                            className={cn(
                              'h-5 w-5',
                              cam.status === 'online'
                                ? 'text-green-500'
                                : cam.status === 'offline'
                                ? 'text-red-500'
                                : 'text-yellow-500'
                            )}
                          />
                          {/* Status dot */}
                          <div
                            className={cn(
                              'absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card',
                              getStatusColor(cam.status),
                              cam.status === 'online' && 'animate-pulse'
                            )}
                          />
                        </button>

                        {/* Label */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap pointer-events-none">
                          <span className="text-[10px] font-medium bg-card/90 backdrop-blur-sm px-1.5 py-0.5 rounded shadow-sm border">
                            {cam.name}
                          </span>
                        </div>

                        {/* Edit actions */}
                        {editMode && isSelected && (
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex gap-1 bg-card rounded-lg shadow-lg border p-1">
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-accent transition-colors"
                              title="Повернуть"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRotatePlacement(idx);
                              }}
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                              title="Удалить"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemovePlacement(idx);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            {!editMode ? null : (
                              <button
                                type="button"
                                className="p-1 rounded hover:bg-accent transition-colors"
                                title="Просмотр"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCameraClick(placement);
                                }}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>

          {/* Camera Sidebar */}
          {editMode && (
            <div className="w-full lg:w-72 shrink-0">
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Камеры
                  </h3>

                  {/* Placed cameras */}
                  {placements.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-muted-foreground mb-2">
                        На плане ({placements.length})
                      </p>
                      <div className="space-y-1.5">
                        {placements.map((placement, idx) => {
                          const cam = cameras.find((c) => c.id === placement.cameraId);
                          if (!cam) return null;
                          return (
                            <div
                              key={placement.cameraId}
                              className={cn(
                                'flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors',
                                selectedPlacementIdx === idx
                                  ? 'border-primary bg-primary/5'
                                  : 'hover:bg-accent'
                              )}
                              onClick={() => setSelectedPlacementIdx(idx)}
                            >
                              <div
                                className={cn(
                                  'w-2 h-2 rounded-full shrink-0',
                                  getStatusColor(cam.status)
                                )}
                              />
                              <span className="truncate flex-1">{cam.name}</span>
                              <button
                                type="button"
                                className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemovePlacement(idx);
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Available cameras (drag source) */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Доступные ({availableCameras.length})
                    </p>
                    {availableCameras.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        Все камеры размещены
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                        {availableCameras.map((cam) => (
                          <div
                            key={cam.id}
                            draggable
                            onDragStart={() => handleCameraDragStart(cam.id)}
                            className="flex items-center gap-2 p-2 rounded-lg border text-sm cursor-grab active:cursor-grabbing hover:bg-accent transition-colors"
                          >
                            <div
                              className={cn(
                                'w-2 h-2 rounded-full shrink-0',
                                getStatusColor(cam.status)
                              )}
                            />
                            <div className="truncate flex-1">
                              <p className="truncate font-medium">{cam.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {cam.location}
                              </p>
                            </div>
                            <Badge
                              variant={cam.status === 'online' ? 'default' : 'destructive'}
                              className="text-[9px] px-1.5 py-0 shrink-0"
                            >
                              {cam.status === 'online' ? 'ON' : 'OFF'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Help */}
                  <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Подсказка:</p>
                    <p>Перетащите камеру из списка на план</p>
                    <p>Нажмите на камеру на плане для выбора</p>
                    <p>Перетаскивайте размещенные камеры для перемещения</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Legend (view mode) */}
      {selectedPlan && !editMode && placements.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <span className="font-medium">Легенда:</span>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-muted-foreground">Онлайн</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-muted-foreground">Офлайн</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-muted-foreground">Предупреждение</span>
              </div>
              <span className="text-muted-foreground ml-auto">
                Камер на плане: {placements.length}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый план объекта</DialogTitle>
            <DialogDescription>
              Загрузите изображение плана этажа (PNG, JPG, SVG)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                placeholder="Этаж 1"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </div>

            {/* Drop zone */}
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
                uploadFile && 'border-green-500 bg-green-500/5'
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
              {uploadFile ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2 text-green-600">
                    <Upload className="h-5 w-5" />
                    <span className="font-medium">{uploadFile.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(uploadFile.size / 1024 / 1024).toFixed(2)} МБ
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadFile(null);
                    }}
                  >
                    Выбрать другой файл
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Перетащите файл или нажмите для выбора
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, SVG, WebP — до 10 МБ
                  </p>
                </div>
              )}
            </div>

            <Button onClick={handleUpload} className="w-full" disabled={uploading}>
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Загрузить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Camera Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              {previewCamera?.name}
            </DialogTitle>
            <DialogDescription>{previewCamera?.location}</DialogDescription>
          </DialogHeader>
          {previewCamera && (
            <div className="px-4 pb-4 space-y-3">
              <div className="aspect-video rounded-lg overflow-hidden bg-black">
                <VideoPlayer
                  src={`/api/cameras/${previewCamera.id}/stream`}
                  live={true}
                  autoPlay={true}
                  muted={true}
                  className="w-full h-full"
                />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Badge
                  variant={previewCamera.status === 'online' ? 'default' : 'destructive'}
                >
                  {previewCamera.status === 'online' ? 'Онлайн' : 'Офлайн'}
                </Badge>
                <span className="text-muted-foreground">{previewCamera.resolution}</span>
                <span className="text-muted-foreground">{previewCamera.fps} FPS</span>
                {previewCamera.isMonitoring && (
                  <Badge variant="secondary" className="gap-1">
                    <Eye className="h-3 w-3" />
                    AI
                  </Badge>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Plan Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить план?</DialogTitle>
            <DialogDescription>
              Это действие нельзя отменить. План и все размещения камер будут удалены.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleDeletePlan}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Удалить
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Отмена
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

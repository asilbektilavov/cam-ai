'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import {
  Archive,
  HardDrive,
  Video,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';
import { toast } from 'sonner';
import { ArchivePlayer } from '@/components/archive-player';
import { useAppStore } from '@/lib/store';
import { useSearchParams } from 'next/navigation';

interface ApiCamera {
  id: string;
  name: string;
  location: string;
  status: string;
}

interface StorageData {
  total: string;
  used: string;
  free: string;
  percent: number;
  recordings: number;
}

export default function ArchivePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <ArchivePageContent />
    </Suspense>
  );
}

function ArchivePageContent() {
  const searchParams = useSearchParams();
  const initialCameraId = searchParams.get('cameraId') || '';

  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(initialCameraId);
  const [loadingCameras, setLoadingCameras] = useState(true);
  const [storage, setStorage] = useState<StorageData | null>(null);

  const { selectedBranchId } = useAppStore();

  const fetchCameras = useCallback(async () => {
    setLoadingCameras(true);
    try {
      const branchParam = selectedBranchId
        ? `?branchId=${selectedBranchId}`
        : '';
      const data = await apiGet<ApiCamera[]>(`/api/cameras${branchParam}`);
      setCameras(data);
      if (data.length > 0 && !selectedCameraId) {
        setSelectedCameraId(data[0].id);
      }
    } catch {
      toast.error('Не удалось загрузить камеры');
    } finally {
      setLoadingCameras(false);
    }
  }, [selectedBranchId, selectedCameraId]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // Fetch storage info from existing /api/storage
  useEffect(() => {
    const fetchStorage = async () => {
      try {
        const data = await apiGet<StorageData>('/api/storage');
        setStorage(data);
      } catch {
        // Storage info may not be available
      }
    };
    fetchStorage();
  }, []);

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  if (loadingCameras) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Видеоархив</h1>
          <p className="text-muted-foreground">
            Просмотр записей с камер по дате и времени
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        {/* Main area */}
        <div className="space-y-6">
          {/* Camera selector */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Video className="h-5 w-5 text-muted-foreground shrink-0" />
                <Select
                  value={selectedCameraId}
                  onValueChange={setSelectedCameraId}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Выберите камеру" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.map((camera) => (
                      <SelectItem key={camera.id} value={camera.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              'h-2 w-2 rounded-full',
                              camera.status === 'online'
                                ? 'bg-green-500'
                                : 'bg-gray-400'
                            )}
                          />
                          {camera.name} — {camera.location}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Archive player */}
          {selectedCamera ? (
            <ArchivePlayer
              cameraId={selectedCamera.id}
              cameraName={selectedCamera.name}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Archive className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  Выберите камеру
                </h3>
                <p className="text-muted-foreground">
                  Выберите камеру для просмотра видеоархива
                </p>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Sidebar — only storage info */}
        <div className="space-y-6">
          {storage && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Хранение
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Progress value={storage.percent} />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Использовано</span>
                    <span className="font-medium">{storage.used}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Свободно</span>
                    <span className="font-medium">{storage.free}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Записей</span>
                    <span className="font-medium">{storage.recordings}</span>
                  </div>
                  {storage.percent > 90 && (
                    <Badge variant="destructive" className="w-full justify-center">
                      Мало места на диске
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

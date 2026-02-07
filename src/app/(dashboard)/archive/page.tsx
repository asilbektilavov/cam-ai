'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import {
  Archive,
  HardDrive,
  Video,
  Loader2,
  Calendar,
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

interface TimelineHour {
  available: boolean;
  segments: number;
  duration: number;
  size: number;
}

interface TimelineResponse {
  hours: Record<string, TimelineHour>;
  totalSegments: number;
  totalDuration: number;
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
  const [timeline, setTimeline] = useState<Record<string, TimelineHour>>({});
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

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

  // Fetch timeline for selected camera + date
  useEffect(() => {
    if (!selectedCameraId) return;
    const fetchTimeline = async () => {
      try {
        const data = await apiGet<TimelineResponse>(
          `/api/cameras/${selectedCameraId}/timeline?date=${selectedDate}`
        );
        setTimeline(data.hours || {});
      } catch {
        setTimeline({});
      }
    };
    fetchTimeline();
  }, [selectedCameraId, selectedDate]);

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  // Build a mini-calendar for current month using timeline data
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  // Hours with recording data for the selected date
  const hoursWithData = Object.values(timeline).filter((h) => h.available).length;
  const totalSegments = Object.values(timeline).reduce((sum, h) => sum + h.segments, 0);

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

          {/* Timeline overview for selected date */}
          {selectedCameraId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Таймлайн записей</span>
                  <input
                    type="date"
                    value={selectedDate}
                    max={today.toISOString().split('T')[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-sm border rounded px-2 py-1 bg-background"
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {hoursWithData === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Нет записей за {selectedDate}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {hoursWithData} часов с записями, {totalSegments} сегментов
                    </p>
                    {/* 24-hour bar */}
                    <div className="flex gap-0.5 h-8 rounded overflow-hidden">
                      {Array.from({ length: 24 }, (_, i) => {
                        const hourKey = String(i).padStart(2, '0');
                        const hour = timeline[hourKey];
                        return (
                          <div
                            key={i}
                            className={cn(
                              'flex-1 relative group cursor-pointer transition-colors',
                              hour?.available
                                ? 'bg-green-500/70 hover:bg-green-500'
                                : 'bg-muted hover:bg-muted-foreground/20'
                            )}
                            title={`${hourKey}:00 — ${hour?.available ? `${hour.segments} сегм.` : 'Нет записей'}`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>00:00</span>
                      <span>06:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>23:59</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Storage card */}
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

          {/* Calendar */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Календарь
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedCameraId ? (
                <div>
                  <p className="text-sm font-medium text-center mb-3">
                    {today.toLocaleString('ru-RU', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>

                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(
                      (day) => (
                        <div
                          key={day}
                          className="text-[10px] text-center text-muted-foreground font-medium"
                        >
                          {day}
                        </div>
                      )
                    )}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: offset }, (_, i) => (
                      <div key={`empty-${i}`} />
                    ))}

                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isToday = day === today.getDate();
                      const isSelected = dateStr === selectedDate;

                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setSelectedDate(dateStr)}
                          className={cn(
                            'relative flex flex-col items-center justify-center h-8 rounded-md text-xs transition-colors',
                            isToday && 'font-bold ring-1 ring-primary',
                            isSelected && 'bg-primary text-primary-foreground',
                            !isSelected && 'hover:bg-accent text-muted-foreground'
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Выберите камеру
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

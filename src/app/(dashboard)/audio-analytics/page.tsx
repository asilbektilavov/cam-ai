'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Volume2,
  Loader2,
  Crosshair,
  Megaphone,
  ShieldAlert,
  BellRing,
  Camera,
  Activity,
  AlertTriangle,
  RefreshCw,
  Clock,
  Ear,
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
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';

interface CameraOption {
  id: string;
  name: string;
  location: string;
}

interface AudioEvent {
  id: string;
  type: 'gunshot' | 'scream' | 'glass_break' | 'alarm' | 'explosion' | 'siren';
  label: string;
  confidence: number;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  cameraName: string;
}

interface AudioAnalyticsData {
  events: AudioEvent[];
  totalEvents: number;
  rmsDb: number;
  peakDb: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

const eventTypeIcons: Record<string, typeof Crosshair> = {
  gunshot: Crosshair,
  scream: Megaphone,
  glass_break: ShieldAlert,
  alarm: BellRing,
  explosion: AlertTriangle,
  siren: BellRing,
};

const eventTypeLabels: Record<string, string> = {
  gunshot: 'Выстрел',
  scream: 'Крик',
  glass_break: 'Разбитие стекла',
  alarm: 'Сигнализация',
  explosion: 'Взрыв',
  siren: 'Сирена',
};

const severityConfig = {
  critical: {
    label: 'Критический',
    color: 'bg-red-500',
    textColor: 'text-red-500',
    badgeBg: 'bg-red-500/10 text-red-500 border-red-500/20',
  },
  warning: {
    label: 'Предупреждение',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-500',
    badgeBg: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  },
  info: {
    label: 'Информация',
    color: 'bg-blue-500',
    textColor: 'text-blue-500',
    badgeBg: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
};

export default function AudioAnalyticsPage() {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AudioAnalyticsData | null>(null);
  const { selectedBranchId } = useAppStore();

  const fetchCameras = useCallback(async () => {
    try {
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const result = await apiGet<CameraOption[]>(`/api/cameras${branchParam}`);
      setCameras(result);
      if (result.length > 0 && !selectedCamera) {
        setSelectedCamera(result[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, selectedCamera]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const fetchAudioData = useCallback(async () => {
    if (!selectedCamera) return;
    try {
      const result = await apiGet<AudioAnalyticsData>(
        `/api/audio-analytics?cameraId=${selectedCamera}`
      );
      setData(result);
    } catch (err) {
      console.error('Failed to fetch audio data:', err);
    }
  }, [selectedCamera]);

  useEffect(() => {
    if (selectedCamera) {
      fetchAudioData();
    }
  }, [selectedCamera, fetchAudioData]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!selectedCamera) return;
    const interval = setInterval(fetchAudioData, 5000);
    return () => clearInterval(interval);
  }, [selectedCamera, fetchAudioData]);

  const formatTime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const normalizeDb = (db: number) => {
    // Normalize dB value to 0-100 range for progress bar
    // Assuming range from -60dB to 0dB
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Аудио-аналитика</h1>
          <p className="text-muted-foreground">
            Обнаружение звуковых событий и анализ аудиопотока
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAudioData} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Обновить
        </Button>
      </div>

      {/* Camera / Mic Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Источник аудио
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedCamera} onValueChange={setSelectedCamera}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Выберите камеру / микрофон" />
            </SelectTrigger>
            <SelectContent>
              {cameras.map((cam) => (
                <SelectItem key={cam.id} value={cam.id}>
                  {cam.name} — {cam.location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {data ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <Activity className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.totalEvents}</p>
                  <p className="text-sm text-muted-foreground">Всего событий</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.criticalCount}</p>
                  <p className="text-sm text-muted-foreground">Критических</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
                  <ShieldAlert className="h-5 w-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.warningCount}</p>
                  <p className="text-sm text-muted-foreground">Предупреждений</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <Ear className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.infoCount}</p>
                  <p className="text-sm text-muted-foreground">Информационных</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Audio Level Meters */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Volume2 className="h-4 w-4" />
                  Уровень RMS
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold tabular-nums">
                    {data.rmsDb.toFixed(1)} дБ
                  </span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      data.rmsDb > -10
                        ? 'text-red-500'
                        : data.rmsDb > -30
                        ? 'text-yellow-500'
                        : 'text-green-500'
                    )}
                  >
                    {data.rmsDb > -10 ? 'Громко' : data.rmsDb > -30 ? 'Нормально' : 'Тихо'}
                  </Badge>
                </div>
                <Progress
                  value={normalizeDb(data.rmsDb)}
                  className={cn(
                    'h-4',
                    data.rmsDb > -10
                      ? '[&>div]:bg-red-500'
                      : data.rmsDb > -30
                      ? '[&>div]:bg-yellow-500'
                      : '[&>div]:bg-green-500'
                  )}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-60 дБ</span>
                  <span>-30 дБ</span>
                  <span>0 дБ</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Пиковый уровень
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold tabular-nums">
                    {data.peakDb.toFixed(1)} дБ
                  </span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      data.peakDb > -5
                        ? 'text-red-500'
                        : data.peakDb > -20
                        ? 'text-yellow-500'
                        : 'text-green-500'
                    )}
                  >
                    {data.peakDb > -5 ? 'Пик' : data.peakDb > -20 ? 'Нормально' : 'Тихо'}
                  </Badge>
                </div>
                <Progress
                  value={normalizeDb(data.peakDb)}
                  className={cn(
                    'h-4',
                    data.peakDb > -5
                      ? '[&>div]:bg-red-500'
                      : data.peakDb > -20
                      ? '[&>div]:bg-yellow-500'
                      : '[&>div]:bg-green-500'
                  )}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-60 дБ</span>
                  <span>-30 дБ</span>
                  <span>0 дБ</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Events Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Последние события
                  </CardTitle>
                  <CardDescription>
                    Обнаруженные звуковые события ({data.events.length})
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {data.events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Volume2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Нет аудио-событий</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Звуковые события появятся при обнаружении характерных звуков
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="col-span-1">Тип</div>
                    <div className="col-span-3">Событие</div>
                    <div className="col-span-2 text-center">Уверенность</div>
                    <div className="col-span-2 text-center">Важность</div>
                    <div className="col-span-2">Камера</div>
                    <div className="col-span-2 text-right">Время</div>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {data.events.map((event) => {
                      const IconComponent = eventTypeIcons[event.type] || Volume2;
                      const severity = severityConfig[event.severity];
                      return (
                        <div
                          key={event.id}
                          className={cn(
                            'grid grid-cols-12 gap-4 items-center px-4 py-3 rounded-lg border transition-colors',
                            event.severity === 'critical'
                              ? 'bg-red-500/5 border-red-500/20'
                              : event.severity === 'warning'
                              ? 'bg-yellow-500/5 border-yellow-500/20'
                              : 'bg-card border-border'
                          )}
                        >
                          {/* Type Icon */}
                          <div className="col-span-1">
                            <div
                              className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-lg',
                                event.severity === 'critical'
                                  ? 'bg-red-500/10'
                                  : event.severity === 'warning'
                                  ? 'bg-yellow-500/10'
                                  : 'bg-blue-500/10'
                              )}
                            >
                              <IconComponent
                                className={cn(
                                  'h-4 w-4',
                                  severity.textColor
                                )}
                              />
                            </div>
                          </div>

                          {/* Label */}
                          <div className="col-span-3">
                            <p className="text-sm font-medium">
                              {eventTypeLabels[event.type] || event.type}
                            </p>
                            <p className="text-xs text-muted-foreground">{event.label}</p>
                          </div>

                          {/* Confidence */}
                          <div className="col-span-2 text-center">
                            <span className="text-sm font-semibold">
                              {Math.round(event.confidence * 100)}%
                            </span>
                          </div>

                          {/* Severity Badge */}
                          <div className="col-span-2 flex justify-center">
                            <Badge
                              variant="outline"
                              className={cn('text-xs', severity.badgeBg)}
                            >
                              {severity.label}
                            </Badge>
                          </div>

                          {/* Camera */}
                          <div className="col-span-2">
                            <p className="text-sm text-muted-foreground truncate">
                              {event.cameraName}
                            </p>
                          </div>

                          {/* Timestamp */}
                          <div className="col-span-2 text-right">
                            <p className="text-sm text-muted-foreground">
                              {formatTime(event.timestamp)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : selectedCamera ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Загрузка аудио-данных...</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Volume2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Выберите источник</h3>
            <p className="text-muted-foreground">
              Выберите камеру или микрофон для анализа аудиопотока
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

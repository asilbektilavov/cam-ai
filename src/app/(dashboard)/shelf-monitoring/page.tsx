'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag,
  Loader2,
  Camera,
  AlertTriangle,
  TrendingUp,
  Package,
  Save,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';

interface CameraOption {
  id: string;
  name: string;
  location: string;
}

interface ShelfStatus {
  cameraId: string;
  cameraName: string;
  fullness: number;
  status: 'full' | 'partial' | 'low' | 'empty';
  lastUpdated: string;
  alertThreshold: number;
  history: { timestamp: string; fullness: number }[];
}

const statusConfig = {
  full: { label: 'Полная', color: 'bg-green-500', textColor: 'text-green-500', bgLight: 'bg-green-500/10' },
  partial: { label: 'Частично', color: 'bg-yellow-500', textColor: 'text-yellow-500', bgLight: 'bg-yellow-500/10' },
  low: { label: 'Мало', color: 'bg-orange-500', textColor: 'text-orange-500', bgLight: 'bg-orange-500/10' },
  empty: { label: 'Пустая', color: 'bg-red-500', textColor: 'text-red-500', bgLight: 'bg-red-500/10' },
};

export default function ShelfMonitoringPage() {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [loading, setLoading] = useState(true);
  const [shelfData, setShelfData] = useState<ShelfStatus | null>(null);
  const [alertThreshold, setAlertThreshold] = useState('30');
  const [savingThreshold, setSavingThreshold] = useState(false);
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

  const fetchShelfData = useCallback(async () => {
    if (!selectedCamera) return;
    try {
      const result = await apiGet<ShelfStatus>(
        `/api/shelf-monitoring?cameraId=${selectedCamera}`
      );
      setShelfData(result);
      if (result.alertThreshold != null) {
        setAlertThreshold(result.alertThreshold.toString());
      }
    } catch (err) {
      console.error('Failed to fetch shelf data:', err);
    }
  }, [selectedCamera]);

  useEffect(() => {
    if (selectedCamera) {
      fetchShelfData();
    }
  }, [selectedCamera, fetchShelfData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!selectedCamera) return;
    const interval = setInterval(fetchShelfData, 10000);
    return () => clearInterval(interval);
  }, [selectedCamera, fetchShelfData]);

  const handleSaveThreshold = async () => {
    const value = parseInt(alertThreshold);
    if (isNaN(value) || value < 0 || value > 100) {
      toast.error('Введите значение от 0 до 100');
      return;
    }
    setSavingThreshold(true);
    try {
      // Simulate saving
      await new Promise((r) => setTimeout(r, 500));
      toast.success(`Порог оповещения установлен: ${value}%`);
    } catch {
      toast.error('Не удалось сохранить порог');
    } finally {
      setSavingThreshold(false);
    }
  };

  const getFullnessColor = (fullness: number) => {
    if (fullness >= 75) return 'text-green-500';
    if (fullness >= 50) return 'text-yellow-500';
    if (fullness >= 25) return 'text-orange-500';
    return 'text-red-500';
  };

  const getProgressColor = (fullness: number) => {
    if (fullness >= 75) return '[&>div]:bg-green-500';
    if (fullness >= 50) return '[&>div]:bg-yellow-500';
    if (fullness >= 25) return '[&>div]:bg-orange-500';
    return '[&>div]:bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = shelfData ? statusConfig[shelfData.status] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Мониторинг полок</h1>
          <p className="text-muted-foreground">
            Контроль наполненности полок в реальном времени
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchShelfData} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Обновить
        </Button>
      </div>

      {/* Camera Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Камера
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedCamera} onValueChange={setSelectedCamera}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Выберите камеру" />
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

      {shelfData ? (
        <>
          {/* Fullness Display */}
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Main fullness card */}
            <Card className="sm:col-span-2">
              <CardContent className="p-8">
                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <p className={cn('text-7xl font-bold tabular-nums', getFullnessColor(shelfData.fullness))}>
                      {shelfData.fullness}%
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">Наполненность полки</p>
                  </div>
                  <div className="flex-1 space-y-4">
                    <Progress
                      value={shelfData.fullness}
                      className={cn('h-6 rounded-full', getProgressColor(shelfData.fullness))}
                    />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">0%</span>
                      <span className="text-muted-foreground">50%</span>
                      <span className="text-muted-foreground">100%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Status card */}
            <Card>
              <CardContent className="p-8 flex flex-col items-center justify-center h-full">
                {status && (
                  <>
                    <div className={cn('flex h-16 w-16 items-center justify-center rounded-full mb-4', status.bgLight)}>
                      <Package className={cn('h-8 w-8', status.textColor)} />
                    </div>
                    <Badge
                      className={cn(
                        'text-lg px-4 py-1 font-semibold',
                        status.color,
                        'text-white border-0'
                      )}
                    >
                      {status.label}
                    </Badge>
                    <div className="flex items-center gap-1 mt-4 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        Обновлено:{' '}
                        {new Date(shelfData.lastUpdated).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <TrendingUp className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {shelfData.history.length > 1
                      ? `${Math.round(
                          shelfData.history.reduce((sum, h) => sum + h.fullness, 0) /
                            shelfData.history.length
                        )}%`
                      : '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">Средняя за период</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <Package className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {shelfData.history.length > 0
                      ? `${Math.max(...shelfData.history.map((h) => h.fullness))}%`
                      : '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">Максимум</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {shelfData.history.length > 0
                      ? `${Math.min(...shelfData.history.map((h) => h.fullness))}%`
                      : '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">Минимум</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* History Chart Placeholder */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                История наполненности
              </CardTitle>
              <CardDescription>Изменения наполненности полки за последние 24 часа</CardDescription>
            </CardHeader>
            <CardContent>
              {shelfData.history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Нет данных истории</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Данные начнут собираться после активации мониторинга
                  </p>
                </div>
              ) : (
                <div className="flex items-end gap-1 h-48">
                  {shelfData.history.map((point, i) => {
                    const height = Math.max(point.fullness, 2);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        {point.fullness > 0 && (
                          <span className="text-[9px] text-muted-foreground">{point.fullness}%</span>
                        )}
                        <div
                          className={cn(
                            'w-full rounded-t-sm transition-all',
                            point.fullness >= 75
                              ? 'bg-green-500'
                              : point.fullness >= 50
                              ? 'bg-yellow-500'
                              : point.fullness >= 25
                              ? 'bg-orange-500'
                              : 'bg-red-500'
                          )}
                          style={{ height: `${height}%` }}
                        />
                        {i % 4 === 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {new Date(point.timestamp).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Alert Threshold Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Порог оповещения
              </CardTitle>
              <CardDescription>
                Получайте уведомление, когда наполненность полки опустится ниже заданного порога
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-4 max-w-md">
                <div className="flex-1 space-y-2">
                  <Label>Порог наполненности (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                    placeholder="30"
                  />
                  <p className="text-xs text-muted-foreground">
                    Оповещение сработает при наполненности ниже {alertThreshold}%
                  </p>
                </div>
                <Button onClick={handleSaveThreshold} disabled={savingThreshold} className="gap-2">
                  {savingThreshold ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Сохранить
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : selectedCamera ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Загрузка данных...</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShoppingBag className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Выберите камеру</h3>
            <p className="text-muted-foreground">
              Выберите камеру для отслеживания наполненности полок
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

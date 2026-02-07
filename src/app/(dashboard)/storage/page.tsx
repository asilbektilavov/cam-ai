'use client';

import { useEffect, useState } from 'react';
import {
  HardDrive,
  Trash2,
  RefreshCw,
  Camera,
  Database,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { apiGet, apiDelete } from '@/lib/api-client';
import { toast } from 'sonner';

interface StorageData {
  total: string;
  used: string;
  free: string;
  percent: number;
  recordings: number;
  perCamera: {
    cameraId: string;
    cameraName: string;
    size: string;
    sizeBytes: number;
    recordings: number;
  }[];
}

export default function StoragePage() {
  const [storage, setStorage] = useState<StorageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);

  const fetchStorage = async () => {
    setLoading(true);
    try {
      const data = await apiGet<StorageData>('/api/storage');
      setStorage(data);
    } catch {
      toast.error('Не удалось загрузить данные хранилища');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStorage();
  }, []);

  const handleCleanup = async (retentionDays?: number) => {
    setCleaning(true);
    try {
      const result = await apiDelete<{ deleted: number }>(
        `/api/storage${retentionDays ? `?retentionDays=${retentionDays}` : ''}`
      );
      toast.success(`Удалено записей: ${result.deleted}`);
      fetchStorage();
    } catch {
      toast.error('Ошибка при очистке');
    } finally {
      setCleaning(false);
    }
  };

  const getUsageColor = (percent: number) => {
    if (percent > 90) return 'text-red-500';
    if (percent > 70) return 'text-yellow-500';
    return 'text-green-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Хранилище</h1>
          <p className="text-muted-foreground">
            Управление видеозаписями и дисковым пространством
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchStorage} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleCleanup()}
            disabled={cleaning}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Очистить старые
          </Button>
        </div>
      </div>

      {storage && (
        <>
          {/* Disk Usage Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <HardDrive className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Всего</p>
                    <p className="text-xl font-bold">{storage.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                    <Database className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Использовано</p>
                    <p className="text-xl font-bold">{storage.used}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                    <HardDrive className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Свободно</p>
                    <p className="text-xl font-bold">{storage.free}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                    <Camera className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Записей</p>
                    <p className="text-xl font-bold">{storage.recordings}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Disk Usage Bar */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Использование диска</span>
                <span className={`text-lg ${getUsageColor(storage.percent)}`}>
                  {storage.percent.toFixed(1)}%
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={storage.percent} className="h-4" />
              {storage.percent > 85 && (
                <div className="mt-3 flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Дисковое пространство заканчивается. Рекомендуется очистить старые записи.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-Camera Usage */}
          <Card>
            <CardHeader>
              <CardTitle>Использование по камерам</CardTitle>
            </CardHeader>
            <CardContent>
              {storage.perCamera.length === 0 ? (
                <p className="text-muted-foreground text-sm">Нет записей</p>
              ) : (
                <div className="space-y-3">
                  {storage.perCamera.map((cam) => (
                    <div
                      key={cam.cameraId}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Camera className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{cam.cameraName}</p>
                          <p className="text-xs text-muted-foreground">
                            {cam.recordings} записей
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">{cam.size}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Быстрые действия</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCleanup(7)}
                disabled={cleaning}
              >
                Удалить старше 7 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCleanup(14)}
                disabled={cleaning}
              >
                Удалить старше 14 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCleanup(30)}
                disabled={cleaning}
              >
                Удалить старше 30 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCleanup(90)}
                disabled={cleaning}
              >
                Удалить старше 90 дней
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {loading && !storage && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

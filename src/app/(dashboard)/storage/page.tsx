'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  HardDrive,
  Trash2,
  RefreshCw,
  Camera,
  Database,
  AlertTriangle,
  Lock,
  CheckCircle2,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiGet, apiDelete, apiPatch } from '@/lib/api-client';
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

interface DiskInfo {
  mountpoint: string;
  total: number;
  used: number;
  free: number;
  percent: number;
  device: string;
}

interface StorageConfig {
  currentPath: string | null;
  defaultPath: string;
  disks: DiskInfo[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(0)} МБ`;
  return `${(bytes / 1_073_741_824).toFixed(1)} ГБ`;
}

export default function StoragePage() {
  const [storage, setStorage] = useState<StorageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);

  // Password dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pendingRetention, setPendingRetention] = useState<number | undefined>(undefined);

  // Storage path selection
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
  const [savingPath, setSavingPath] = useState(false);

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

  const fetchStorageConfig = useCallback(async () => {
    try {
      const data = await apiGet<StorageConfig>('/api/settings/storage');
      setStorageConfig(data);
    } catch { /* ignore */ }
  }, []);

  const handleSelectDisk = async (mountpoint: string) => {
    setSavingPath(true);
    try {
      const storagePath = mountpoint === '__default__' ? null : mountpoint;
      await apiPatch('/api/settings/storage', { storagePath });
      toast.success(storagePath ? `Хранилище: ${storagePath}` : 'Хранилище: по умолчанию (SSD)');
      await fetchStorageConfig();
      await fetchStorage();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сохранения');
    } finally {
      setSavingPath(false);
    }
  };

  useEffect(() => {
    fetchStorage();
    fetchStorageConfig();
  }, [fetchStorageConfig]);

  const openCleanupDialog = (retentionDays?: number) => {
    setPendingRetention(retentionDays);
    setPassword('');
    setDialogOpen(true);
  };

  const handleConfirmCleanup = async () => {
    if (!password.trim()) {
      toast.error('Введите пароль');
      return;
    }

    setCleaning(true);
    setDialogOpen(false);

    try {
      const result = await apiDelete<{ deleted: number }>('/api/storage', {
        password,
        retentionDays: pendingRetention,
      });
      toast.success(`Удалено записей: ${result.deleted}`);
      fetchStorage();
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка при очистке');
    } finally {
      setCleaning(false);
      setPassword('');
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
            onClick={() => openCleanupDialog()}
            disabled={cleaning}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Очистить старые
          </Button>
        </div>
      </div>

      {/* Storage Path Selection */}
      {storageConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Путь хранения записей
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Выберите диск для хранения видеозаписей. Настройка сохраняется и действует после перезапуска.
            </p>
            <div className="space-y-2">
              {/* Default (SSD) option */}
              <button
                onClick={() => handleSelectDisk('__default__')}
                disabled={savingPath}
                className={`w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${
                  !storageConfig.currentPath ? 'border-green-500 bg-green-500/5' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <HardDrive className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium">По умолчанию (системный диск)</p>
                    <p className="text-xs text-muted-foreground font-mono">{storageConfig.defaultPath}</p>
                  </div>
                </div>
                {!storageConfig.currentPath && (
                  <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                )}
              </button>

              {/* Available disks */}
              {storageConfig.disks.map((disk) => {
                const isSelected = storageConfig.currentPath?.startsWith(disk.mountpoint);
                return (
                  <button
                    key={disk.mountpoint}
                    onClick={() => handleSelectDisk(disk.mountpoint)}
                    disabled={savingPath}
                    className={`w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${
                      isSelected ? 'border-green-500 bg-green-500/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <HardDrive className="h-5 w-5 text-purple-500" />
                      <div>
                        <p className="text-sm font-medium">{disk.device}</p>
                        <p className="text-xs text-muted-foreground font-mono">{disk.mountpoint}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatBytes(disk.free)} свободно из {formatBytes(disk.total)} ({disk.percent}% занято)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                    </div>
                  </button>
                );
              })}

              {storageConfig.disks.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  Дополнительные диски не обнаружены. Подключите HDD и перезагрузите страницу.
                </p>
              )}
            </div>
            {savingPath && (
              <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Сохранение...
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  <span>Дисковое пространство заканчивается. Автоочистка удалит старые записи при заполнении на 85%.</span>
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
                onClick={() => openCleanupDialog(7)}
                disabled={cleaning}
              >
                Удалить старше 7 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openCleanupDialog(14)}
                disabled={cleaning}
              >
                Удалить старше 14 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openCleanupDialog(30)}
                disabled={cleaning}
              >
                Удалить старше 30 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openCleanupDialog(90)}
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

      {/* Password Confirmation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Подтверждение очистки
            </DialogTitle>
            <DialogDescription>
              {pendingRetention
                ? `Будут удалены записи старше ${pendingRetention} дней.`
                : 'Будут удалены записи старше 30 дней (по умолчанию).'}
              {' '}Введите пароль аккаунта для подтверждения.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCleanup();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleConfirmCleanup} disabled={!password.trim()}>
              Подтвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

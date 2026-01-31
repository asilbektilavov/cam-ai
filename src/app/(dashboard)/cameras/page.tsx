'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Camera,
  Plus,
  MoreVertical,
  Wifi,
  WifiOff,
  Eye,
  Trash2,
  Settings,
  Video,
  Monitor,
  Loader2,
  Play,
  Square,
  Link,
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { CameraFeed } from '@/components/camera-feed';
import { useMotionTracker } from '@/hooks/use-motion-tracker';
import { useSearchDescriptors } from '@/hooks/use-search-descriptors';
import { FeatureConfigPanel } from '@/components/smart-features/feature-config-panel';

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
  motionThreshold: number;
  captureInterval: number;
  createdAt: string;
  updatedAt: string;
}

export default function CamerasPage() {
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [togglingMonitor, setTogglingMonitor] = useState<string | null>(null);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [editForm, setEditForm] = useState({ streamUrl: '', name: '', location: '' });
  const [saving, setSaving] = useState(false);
  const [newCamera, setNewCamera] = useState({
    name: '',
    location: '',
    streamUrl: '',
    resolution: '1920x1080',
    fps: 30,
  });

  const { hasMotion } = useMotionTracker();
  const { descriptors: searchDescriptors } = useSearchDescriptors();

  const fetchCameras = useCallback(async () => {
    try {
      const data = await apiGet<ApiCamera[]>('/api/cameras');
      setCameras(data);
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // Auto-refresh snapshots every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setSnapshotTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTestConnection = async () => {
    if (!newCamera.streamUrl) {
      toast.error('Укажите URL потока');
      return;
    }
    setTestingConnection(true);
    try {
      const result = await apiPost<{ success: boolean; error?: string }>(
        '/api/cameras/test-connection',
        { streamUrl: newCamera.streamUrl }
      );
      if (result.success) {
        toast.success('Подключение успешно!');
      } else {
        toast.error(`Ошибка: ${result.error}`);
      }
    } catch {
      toast.error('Не удалось проверить подключение');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleAdd = async () => {
    if (!newCamera.name || !newCamera.location || !newCamera.streamUrl) {
      toast.error('Заполните все обязательные поля');
      return;
    }
    try {
      await apiPost('/api/cameras', newCamera);
      toast.success(`Камера "${newCamera.name}" добавлена`);
      setNewCamera({ name: '', location: '', streamUrl: '', resolution: '1920x1080', fps: 30 });
      setDialogOpen(false);
      fetchCameras();
    } catch {
      toast.error('Не удалось добавить камеру');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/cameras/${id}`);
      toast.success('Камера удалена');
      fetchCameras();
    } catch {
      toast.error('Не удалось удалить камеру');
    }
  };

  const handleToggleMonitor = async (camera: ApiCamera) => {
    setTogglingMonitor(camera.id);
    try {
      if (camera.isMonitoring) {
        await apiDelete(`/api/cameras/${camera.id}/monitor`);
        toast.success('Мониторинг остановлен');
      } else {
        await apiPost(`/api/cameras/${camera.id}/monitor`, {});
        toast.success('Мониторинг запущен');
      }
      fetchCameras();
    } catch {
      toast.error('Не удалось переключить мониторинг');
    } finally {
      setTogglingMonitor(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedCamera) return;
    setSaving(true);
    try {
      await apiPatch(`/api/cameras/${selectedCamera}`, {
        name: editForm.name,
        location: editForm.location,
        streamUrl: editForm.streamUrl,
      });
      toast.success('Настройки сохранены');
      setSettingsDialogOpen(false);
      fetchCameras();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const openSettings = (camera: ApiCamera) => {
    setSelectedCamera(camera.id);
    setEditForm({ streamUrl: camera.streamUrl, name: camera.name, location: camera.location });
    setSettingsDialogOpen(true);
  };

  const onlineCameras = cameras.filter((c) => c.status === 'online').length;
  const offlineCameras = cameras.filter((c) => c.status === 'offline').length;
  const monitoringCameras = cameras.filter((c) => c.isMonitoring).length;

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
          <h1 className="text-2xl font-bold">Камеры</h1>
          <p className="text-muted-foreground">Управление камерами видеонаблюдения</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить камеру
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Добавить камеру</DialogTitle>
              <DialogDescription>Поддерживаются RTSP камеры (Hikvision, Dahua и др.) и IP Webcam</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Название камеры</Label>
                <Input
                  placeholder="Камера входа"
                  value={newCamera.name}
                  onChange={(e) => setNewCamera({ ...newCamera, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Расположение</Label>
                <Input
                  placeholder="Главный вход"
                  value={newCamera.location}
                  onChange={(e) => setNewCamera({ ...newCamera, location: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Тип камеры</Label>
                <Select
                  value={newCamera.streamUrl.startsWith('rtsp://') ? 'rtsp' : 'http'}
                  onValueChange={(v) => {
                    if (v === 'rtsp') {
                      setNewCamera({ ...newCamera, streamUrl: 'rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101' });
                    } else {
                      setNewCamera({ ...newCamera, streamUrl: 'http://192.168.1.100:8080' });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rtsp">RTSP камера (Hikvision, Dahua, Trassir...)</SelectItem>
                    <SelectItem value="http">IP Webcam (Android)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>URL потока</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={
                      newCamera.streamUrl.startsWith('rtsp://')
                        ? 'rtsp://admin:password@192.168.1.100:554/...'
                        : 'http://192.168.1.100:8080'
                    }
                    value={newCamera.streamUrl}
                    onChange={(e) => setNewCamera({ ...newCamera, streamUrl: e.target.value })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    className="shrink-0"
                  >
                    {testingConnection ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {newCamera.streamUrl.startsWith('rtsp://') ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Шаблоны URL для популярных камер:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { label: 'Hikvision', url: 'rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101' },
                        { label: 'Dahua', url: 'rtsp://admin:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0' },
                        { label: 'Trassir', url: 'rtsp://admin:password@192.168.1.100:554/live/main' },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className="text-[10px] px-2 py-0.5 rounded-full bg-muted hover:bg-accent transition-colors"
                          onClick={() => setNewCamera({ ...newCamera, streamUrl: preset.url })}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Замените admin:password на логин/пароль камеры, IP на адрес камеры
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Для IP Webcam: откройте приложение, нажмите «Запустить сервер» и введите URL
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Разрешение</Label>
                  <Select
                    value={newCamera.resolution}
                    onValueChange={(v) => setNewCamera({ ...newCamera, resolution: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1280x720">720p</SelectItem>
                      <SelectItem value="1920x1080">1080p</SelectItem>
                      <SelectItem value="2560x1440">2K</SelectItem>
                      <SelectItem value="3840x2160">4K</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>FPS</Label>
                  <Select
                    value={newCamera.fps.toString()}
                    onValueChange={(v) => setNewCamera({ ...newCamera, fps: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 FPS</SelectItem>
                      <SelectItem value="20">20 FPS</SelectItem>
                      <SelectItem value="25">25 FPS</SelectItem>
                      <SelectItem value="30">30 FPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleAdd} className="w-full">
                Добавить
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Wifi className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{onlineCameras}</p>
              <p className="text-sm text-muted-foreground">Онлайн</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <WifiOff className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{offlineCameras}</p>
              <p className="text-sm text-muted-foreground">Офлайн</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Eye className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{monitoringCameras}</p>
              <p className="text-sm text-muted-foreground">Мониторинг</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Camera Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Настройки камеры</DialogTitle>
            <DialogDescription>Редактирование параметров и умные функции</DialogDescription>
          </DialogHeader>
          {(() => {
            const cam = cameras.find((c) => c.id === selectedCamera);
            if (!cam) return null;
            return (
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Название</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Расположение</Label>
                  <Input
                    value={editForm.location}
                    onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>URL потока</Label>
                  <Input
                    value={editForm.streamUrl}
                    onChange={(e) => setEditForm({ ...editForm, streamUrl: e.target.value })}
                    placeholder="http://192.168.1.100:8080"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Статус</p>
                    <p className="font-medium">{cam.status === 'online' ? 'Онлайн' : 'Офлайн'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Разрешение</p>
                    <p className="font-medium">{cam.resolution}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Порог движения</p>
                    <p className="font-medium">{cam.motionThreshold}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Интервал захвата</p>
                    <p className="font-medium">{cam.captureInterval} сек</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={handleSaveSettings}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Сохранить
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSettingsDialogOpen(false)}
                  >
                    Отмена
                  </Button>
                </div>

                {/* Smart Features */}
                <div className="border-t pt-4">
                  <FeatureConfigPanel cameraId={cam.id} />
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Camera Grid */}
      {cameras.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Camera className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Камеры не добавлены</h3>
            <p className="text-muted-foreground mb-4">
              Добавьте первую камеру для начала видеонаблюдения с ИИ-анализом
            </p>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Добавить камеру
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cameras.map((camera) => {
            const motionActive = hasMotion(camera.id);
            return (
              <Card
                key={camera.id}
                className={cn(
                  'overflow-hidden transition-all duration-300',
                  motionActive && 'ring-2 ring-green-500 shadow-lg shadow-green-500/20'
                )}
              >
                {/* Camera Preview */}
                <div className="relative aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                  {camera.status === 'online' ? (
                    <>
                      <CameraFeed
                        cameraId={camera.id}
                        snapshotTick={snapshotTick}
                        className="absolute inset-0 w-full h-full"
                        showFaceDetection={camera.isMonitoring}
                        rotateImage={!camera.streamUrl.startsWith('rtsp://')}
                        searchDescriptors={camera.isMonitoring ? searchDescriptors : undefined}
                      />
                      <Video className="h-10 w-10 text-gray-600" />
                    </>
                  ) : (
                    <Monitor className="h-10 w-10 text-gray-700" />
                  )}
                  {camera.status === 'online' && (
                    <>
                      <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] text-red-400 font-medium">REC</span>
                      </div>
                      {camera.isMonitoring && (
                        <div className="absolute top-2 right-2 z-10">
                          <div className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5">
                            <Eye className="h-3 w-3 text-green-400" />
                            <span className="text-[10px] text-green-400">AI</span>
                          </div>
                        </div>
                      )}
                      {motionActive && (
                        <div className="absolute top-2 left-16 z-10">
                          <div className="flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 animate-pulse">
                            <span className="text-[10px] text-white font-bold">ДВИЖЕНИЕ</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent h-16 z-10" />
                  <div className="absolute bottom-2 left-2 z-10">
                    <Badge
                      variant={camera.status === 'online' ? 'default' : 'destructive'}
                      className="text-[10px]"
                    >
                      {camera.status === 'online' ? 'LIVE' : 'ОФЛАЙН'}
                    </Badge>
                  </div>
                </div>

                {/* Camera Info */}
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{camera.name}</h3>
                      <p className="text-sm text-muted-foreground">{camera.location}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleToggleMonitor(camera)}
                          disabled={togglingMonitor === camera.id}
                          className="cursor-pointer"
                        >
                          {camera.isMonitoring ? (
                            <>
                              <Square className="h-4 w-4 mr-2" />
                              Остановить мониторинг
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              Запустить мониторинг
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openSettings(camera)}
                          className="cursor-pointer"
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Настройки
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive cursor-pointer"
                          onClick={() => handleDelete(camera.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span>{camera.resolution}</span>
                    <span>{camera.fps} FPS</span>
                    {camera.isMonitoring && (
                      <Badge variant="secondary" className="text-[10px]">
                        Мониторинг
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

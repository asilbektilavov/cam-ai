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
  Search,
  ChevronRight,
  Check,
  UserCheck,
  LogIn,
  LogOut as LogOutIcon,
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
import { Go2rtcPlayer } from '@/components/go2rtc-player';
import { useMotionTracker } from '@/hooks/use-motion-tracker';
import { useSearchDescriptors } from '@/hooks/use-search-descriptors';
import { FeatureConfigPanel } from '@/components/smart-features/feature-config-panel';
import { useAppStore } from '@/lib/store';
import { useRouter } from 'next/navigation';

interface ApiCamera {
  id: string;
  name: string;
  location: string;
  streamUrl: string;
  status: string;
  venueType: string;
  purpose: string;
  resolution: string;
  fps: number;
  isMonitoring: boolean;
  motionThreshold: number;
  captureInterval: number;
  createdAt: string;
  updatedAt: string;
}

const PURPOSE_LABELS: Record<string, string> = {
  detection: 'Обнаружение',
  attendance_entry: 'Вход',
  attendance_exit: 'Выход',
};

export default function CamerasPage() {
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [togglingMonitor, setTogglingMonitor] = useState<string | null>(null);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [editForm, setEditForm] = useState({ streamUrl: '', name: '', location: '', purpose: 'detection' });
  const [saving, setSaving] = useState(false);
  const [newCamera, setNewCamera] = useState({
    name: '',
    location: '',
    streamUrl: '',
    resolution: '1920x1080',
    fps: 30,
    purpose: 'detection',
  });
  const [scanning, setScanning] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<Array<{
    ip: string;
    ports: number[];
    protocol: string;
    suggestedUrl: string;
    brand?: string;
    name: string;
    manufacturer?: string;
    model?: string;
    onvifSupported: boolean;
    alreadyAdded: boolean;
    existingCameraId?: string;
  }>>([]);
  const [scanCredentials, setScanCredentials] = useState({ username: 'admin', password: '' });
  const [showCredentials, setShowCredentials] = useState(false);
  const [addingCameraIp, setAddingCameraIp] = useState<string | null>(null);
  const [testingCameraIp, setTestingCameraIp] = useState<string | null>(null);

  const router = useRouter();
  const { hasMotion } = useMotionTracker();
  const { descriptors: searchDescriptors } = useSearchDescriptors();
  const { selectedBranchId } = useAppStore();

  const fetchCameras = useCallback(async () => {
    try {
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const data = await apiGet<ApiCamera[]>(`/api/cameras${branchParam}`);
      setCameras(data);
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

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

  const handleScanNetwork = async () => {
    setScanning(true);
    setScanDialogOpen(true);
    setDiscoveredCameras([]);
    try {
      const credParam = showCredentials
        ? `?credentials=${encodeURIComponent(scanCredentials.username)}:${encodeURIComponent(scanCredentials.password)}`
        : '';
      const data = await apiGet<Array<{
        ip: string;
        ports: number[];
        protocol: string;
        suggestedUrl: string;
        brand?: string;
        name: string;
        manufacturer?: string;
        model?: string;
        onvifSupported: boolean;
        alreadyAdded: boolean;
        existingCameraId?: string;
      }>>(`/api/cameras/discover${credParam}`);
      setDiscoveredCameras(data);
    } catch {
      toast.error('Не удалось просканировать сеть');
    } finally {
      setScanning(false);
    }
  };

  const handleSelectDiscovered = (cam: { ip: string; suggestedUrl: string; brand?: string; name?: string }) => {
    // Replace hardcoded credentials with user-provided ones (or placeholder)
    let url = cam.suggestedUrl;
    if (url.startsWith('rtsp://')) {
      const user = showCredentials ? scanCredentials.username : 'admin';
      const pass = showCredentials ? scanCredentials.password : '';
      const cred = pass ? `${user}:${pass}` : user;
      url = url.replace(/rtsp:\/\/[^@]*@/, `rtsp://${cred}@`);
    }
    setNewCamera({
      ...newCamera,
      name: cam.name || cam.brand || 'Камера',
      streamUrl: url,
      location: `IP: ${cam.ip}`,
    });
    setScanDialogOpen(false);
    setDialogOpen(true);
  };

  const handleQuickAdd = async (cam: { ip: string; suggestedUrl: string; name: string; brand?: string }) => {
    if (!selectedBranchId) {
      toast.error('Сначала выберите филиал');
      return;
    }
    setAddingCameraIp(cam.ip);
    try {
      let url = cam.suggestedUrl;
      if (url.startsWith('rtsp://')) {
        const user = showCredentials ? scanCredentials.username : 'admin';
        const pass = showCredentials ? scanCredentials.password : '';
        const cred = pass ? `${user}:${pass}` : user;
        url = url.replace(/rtsp:\/\/[^@]*@/, `rtsp://${cred}@`);
      }
      await apiPost('/api/cameras', {
        name: cam.name || cam.brand || 'Камера',
        location: `IP: ${cam.ip}`,
        streamUrl: url,
        branchId: selectedBranchId,
        resolution: '1920x1080',
        fps: 30,
      });
      toast.success(`Камера "${cam.name}" добавлена`);
      setDiscoveredCameras((prev) =>
        prev.map((d) => (d.ip === cam.ip ? { ...d, alreadyAdded: true } : d))
      );
      fetchCameras();
    } catch {
      toast.error('Не удалось добавить камеру');
    } finally {
      setAddingCameraIp(null);
    }
  };

  const handleTestDiscovered = async (cam: { ip: string; suggestedUrl: string }) => {
    setTestingCameraIp(cam.ip);
    try {
      const result = await apiPost<{ success: boolean; error?: string }>(
        '/api/cameras/test-connection',
        { streamUrl: cam.suggestedUrl }
      );
      if (result.success) {
        toast.success(`${cam.ip}: Подключение успешно`);
      } else {
        toast.error(`${cam.ip}: ${result.error}`);
      }
    } catch {
      toast.error(`${cam.ip}: Ошибка проверки`);
    } finally {
      setTestingCameraIp(null);
    }
  };

  const handleAdd = async () => {
    if (!newCamera.name || !newCamera.location || !newCamera.streamUrl) {
      toast.error('Заполните все обязательные поля');
      return;
    }
    if (!selectedBranchId) {
      toast.error('Выберите филиал');
      return;
    }
    try {
      await apiPost('/api/cameras', { ...newCamera, branchId: selectedBranchId });
      toast.success(`Камера "${newCamera.name}" добавлена`);
      setNewCamera({ name: '', location: '', streamUrl: '', resolution: '1920x1080', fps: 30, purpose: 'detection' });
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
        purpose: editForm.purpose,
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
    setEditForm({ streamUrl: camera.streamUrl, name: camera.name, location: camera.location, purpose: camera.purpose || 'detection' });
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
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleScanNetwork} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Поиск камер
          </Button>
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
            <Button
              variant="outline"
              className="w-full gap-2 mt-2"
              onClick={() => {
                setDialogOpen(false);
                handleScanNetwork();
              }}
              disabled={scanning}
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Найти камеры в сети
            </Button>
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
                <Label>Назначение</Label>
                <Select
                  value={newCamera.purpose}
                  onValueChange={(v) => setNewCamera({ ...newCamera, purpose: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="detection">Обнаружение объектов (YOLO)</SelectItem>
                    <SelectItem value="attendance_entry">Посещаемость — камера входа</SelectItem>
                    <SelectItem value="attendance_exit">Посещаемость — камера выхода</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Протокол</Label>
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
      </div>

      {/* Scan Results Dialog */}
      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Поиск камер в сети</DialogTitle>
            <DialogDescription>
              Сканирование всех подсетей и ONVIF. Найденные камеры можно добавить в один клик.
            </DialogDescription>
          </DialogHeader>

          {/* ONVIF credentials */}
          <div className="space-y-2">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setShowCredentials(!showCredentials)}
            >
              <Settings className="h-3 w-3" />
              {showCredentials ? 'Скрыть' : 'Указать'} логин/пароль ONVIF
            </button>
            {showCredentials && (
              <div className="flex gap-2">
                <Input
                  placeholder="Логин"
                  value={scanCredentials.username}
                  onChange={(e) => setScanCredentials({ ...scanCredentials, username: e.target.value })}
                  className="h-8 text-sm"
                />
                <Input
                  type="password"
                  placeholder="Пароль"
                  value={scanCredentials.password}
                  onChange={(e) => setScanCredentials({ ...scanCredentials, password: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            )}
          </div>

          {/* Rescan button */}
          {!scanning && discoveredCameras.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleScanNetwork} className="w-fit gap-2">
              <Search className="h-3 w-3" />
              Повторить поиск
            </Button>
          )}

          {/* Results */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {scanning ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Сканирование сети...</p>
                <p className="text-xs text-muted-foreground">Поиск по всем подсетям и ONVIF</p>
              </div>
            ) : discoveredCameras.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-center">
                <Search className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Камеры не найдены</p>
                <p className="text-xs text-muted-foreground">Убедитесь, что камеры подключены к сети</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Найдено: {discoveredCameras.length} устройств
                </p>
                {discoveredCameras.map((cam) => (
                  <div
                    key={cam.ip}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border transition-colors',
                      cam.alreadyAdded ? 'bg-muted/50 opacity-60' : 'hover:bg-accent'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                        <Camera className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate">{cam.name}</p>
                          {cam.onvifSupported && (
                            <Badge variant="secondary" className="text-[10px]">ONVIF</Badge>
                          )}
                          {cam.alreadyAdded && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Check className="h-2.5 w-2.5" />
                              Добавлена
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {cam.ip} — порты: {cam.ports.join(', ')}
                          {cam.manufacturer && ` — ${cam.manufacturer}`}
                          {cam.model && ` ${cam.model}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {!cam.alreadyAdded && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={testingCameraIp === cam.ip}
                            onClick={() => handleTestDiscovered(cam)}
                            title="Тест подключения"
                          >
                            {testingCameraIp === cam.ip ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Link className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 px-3 text-xs gap-1"
                            disabled={addingCameraIp === cam.ip}
                            onClick={() => handleQuickAdd(cam)}
                          >
                            {addingCameraIp === cam.ip ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                            Добавить
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleSelectDiscovered(cam)}
                            title="Настроить и добавить"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                <div className="space-y-2">
                  <Label>Назначение</Label>
                  <Select
                    value={editForm.purpose}
                    onValueChange={(v) => setEditForm({ ...editForm, purpose: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="detection">Обнаружение объектов (YOLO)</SelectItem>
                      <SelectItem value="attendance_entry">Посещаемость — камера входа</SelectItem>
                      <SelectItem value="attendance_exit">Посещаемость — камера выхода</SelectItem>
                    </SelectContent>
                  </Select>
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
                      {camera.isMonitoring ? (
                        <Go2rtcPlayer
                          streamName={camera.id}
                          className="absolute inset-0 w-full h-full z-[1]"
                          protocol={camera.streamUrl.toLowerCase().startsWith('rtsp://') ? 'rtsp' : 'http'}
                        />
                      ) : (
                        <CameraFeed
                          cameraId={camera.id}
                          snapshotTick={snapshotTick}
                          className="absolute inset-0 w-full h-full"
                          showFaceDetection={false}
                          rotateImage={!camera.streamUrl.startsWith('rtsp://')}
                        />
                      )}
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
                  <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1">
                    <Badge
                      variant={camera.status === 'online' ? 'default' : 'destructive'}
                      className="text-[10px]"
                    >
                      {camera.status === 'online' ? 'LIVE' : 'ОФЛАЙН'}
                    </Badge>
                    {camera.purpose && camera.purpose !== 'detection' && (
                      <Badge variant="outline" className="text-[10px] bg-black/50 text-white border-white/30">
                        {camera.purpose === 'attendance_entry' ? (
                          <><LogIn className="h-3 w-3 mr-0.5" />Вход</>
                        ) : (
                          <><LogOutIcon className="h-3 w-3 mr-0.5" />Выход</>
                        )}
                      </Badge>
                    )}
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
                          onClick={() => router.push(`/cameras/${camera.id}`)}
                          className="cursor-pointer"
                        >
                          <Video className="h-4 w-4 mr-2" />
                          Смотреть / PTZ
                        </DropdownMenuItem>
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

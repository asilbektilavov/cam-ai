'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Video,
  VideoOff,
  Circle,
  Square,
  Settings,
  Loader2,
  Wifi,
  WifiOff,
  Eye,
  Monitor,
  Archive,
  Download,
  MapPin,
  Users,
  Shield,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DetectionVideoPlayer } from '@/components/detection-video-player';
import { PtzControls } from '@/components/ptz-controls';
import { ExportDialog } from '@/components/export-dialog';
import HeatmapOverlay from '@/components/heatmap-overlay';
import PeopleCounterWidget from '@/components/people-counter-widget';
import { apiGet, apiPost, apiPatch } from '@/lib/api-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CameraDetail {
  id: string;
  name: string;
  location: string;
  streamUrl: string;
  status: string;
  venueType: string;
  resolution: string;
  fps: number;
  isMonitoring: boolean;
  isRecording: boolean;
  isStreaming: boolean;
  retentionDays: number;
  onvifHost: string | null;
  onvifPort: number | null;
  onvifUser: string | null;
  onvifPass: string | null;
  hasPtz: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function CameraDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cameraId = params.id as string;

  const [camera, setCamera] = useState<CameraDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamAction, setStreamAction] = useState<'starting' | 'stopping' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [onvifForm, setOnvifForm] = useState({
    onvifHost: '',
    onvifPort: 80,
    onvifUser: '',
    onvifPass: '',
    hasPtz: false,
  });

  const fetchCamera = useCallback(async () => {
    try {
      const data = await apiGet<CameraDetail>(`/api/cameras/${cameraId}`);
      setCamera(data);
      setOnvifForm({
        onvifHost: data.onvifHost || '',
        onvifPort: data.onvifPort || 80,
        onvifUser: data.onvifUser || '',
        onvifPass: data.onvifPass || '',
        hasPtz: data.hasPtz,
      });
    } catch {
      toast.error('Камера не найдена');
      router.push('/cameras');
    } finally {
      setLoading(false);
    }
  }, [cameraId, router]);

  useEffect(() => {
    fetchCamera();
  }, [fetchCamera]);

  const handleStreamToggle = async () => {
    if (!camera) return;
    const action = camera.isStreaming ? 'stop' : 'start';
    setStreamAction(action === 'start' ? 'starting' : 'stopping');
    try {
      await apiPost(`/api/cameras/${cameraId}/stream`, { action });
      toast.success(action === 'start' ? 'Трансляция запущена' : 'Трансляция остановлена');
      // Refresh after a small delay to let stream start
      setTimeout(fetchCamera, 1000);
    } catch {
      toast.error('Не удалось управлять трансляцией');
    } finally {
      setStreamAction(null);
    }
  };

  const handleSaveOnvif = async () => {
    setSaving(true);
    try {
      await apiPatch(`/api/cameras/${cameraId}`, onvifForm);
      toast.success('Настройки ONVIF сохранены');
      setSettingsOpen(false);
      fetchCamera();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!camera) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/cameras')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{camera.name}</h1>
              <Badge variant={camera.status === 'online' ? 'default' : 'destructive'}>
                {camera.status === 'online' ? (
                  <><Wifi className="h-3 w-3 mr-1" /> Онлайн</>
                ) : (
                  <><WifiOff className="h-3 w-3 mr-1" /> Офлайн</>
                )}
              </Badge>
              {camera.isMonitoring && (
                <Badge variant="secondary">
                  <Eye className="h-3 w-3 mr-1" /> AI
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">{camera.location}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4 mr-2" />
            Экспорт
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/archive?cameraId=${cameraId}`}>
              <Archive className="h-4 w-4 mr-2" />
              Архив
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            ONVIF
          </Button>
        </div>
      </div>

      {/* Main content: Video + PTZ */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Video Area */}
        <div className="space-y-4">
          {/* Video Player */}
          <div className="relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900">
            {camera.isStreaming || camera.isMonitoring ? (
              <DetectionVideoPlayer
                src={camera.isStreaming ? `/api/cameras/${cameraId}/stream` : ''}
                cameraId={cameraId}
                streamUrl={camera.streamUrl}
                live
                className="absolute inset-0 w-full h-full"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <Monitor className="h-16 w-16 text-gray-600" />
                <p className="text-gray-400 text-sm">
                  Трансляция не активна
                </p>
                <Button onClick={handleStreamToggle} disabled={!!streamAction}>
                  {streamAction === 'starting' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Video className="h-4 w-4 mr-2" />
                  )}
                  Запустить трансляцию
                </Button>
              </div>
            )}
          </div>

          {/* Stream Controls */}
          <div className="flex items-center gap-3">
            {camera.isStreaming ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStreamToggle}
                  disabled={!!streamAction}
                >
                  {streamAction === 'stopping' ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <VideoOff className="h-4 w-4 mr-2" />
                  )}
                  Остановить трансляцию
                </Button>
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Circle className={cn(
                      'h-3 w-3',
                      camera.isRecording ? 'text-red-500 fill-red-500 animate-pulse' : 'text-gray-400'
                    )} />
                    <span className={camera.isRecording ? 'text-red-500' : 'text-muted-foreground'}>
                      {camera.isRecording ? 'Запись идёт' : 'Запись выключена'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Запустите трансляцию для просмотра живого видео и PTZ-управления
              </div>
            )}
          </div>

          {/* Camera Info Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Разрешение</p>
                <p className="font-medium">{camera.resolution}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">FPS</p>
                <p className="font-medium">{camera.fps}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">Хранение</p>
                <p className="font-medium">{camera.retentionDays} дней</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">ONVIF</p>
                <p className="font-medium">
                  {camera.onvifHost ? `${camera.onvifHost}:${camera.onvifPort}` : 'Не настроен'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Analytics Tabs */}
          <Tabs defaultValue="heatmap" className="mt-2">
            <TabsList>
              <TabsTrigger value="heatmap">
                <MapPin className="h-4 w-4 mr-1.5" />
                Тепловая карта
              </TabsTrigger>
              <TabsTrigger value="people">
                <Users className="h-4 w-4 mr-1.5" />
                Подсчёт людей
              </TabsTrigger>
            </TabsList>

            <TabsContent value="heatmap">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Тепловая карта активности
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <HeatmapOverlay cameraId={cameraId} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="people">
              <PeopleCounterWidget
                cameraId={cameraId}
                cameraName={camera.name}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* PTZ Sidebar */}
        <div className="space-y-4">
          <PtzControls
            cameraId={cameraId}
            hasPtz={camera.hasPtz}
          />

          {/* Quick Links */}
          <Card>
            <CardHeader className="pb-3 px-4 pt-4">
              <CardTitle className="text-sm">Быстрые ссылки</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/archive?cameraId=${cameraId}`}>
                  <Archive className="h-4 w-4 mr-2" />
                  Видеоархив
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href="/storage">
                  <Square className="h-4 w-4 mr-2" />
                  Хранилище
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Export Dialog */}
      <ExportDialog
        cameraId={cameraId}
        cameraName={camera.name}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />

      {/* ONVIF Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки ONVIF / PTZ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>ONVIF Хост (IP)</Label>
              <Input
                placeholder="192.168.1.100"
                value={onvifForm.onvifHost}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifHost: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Порт</Label>
              <Input
                type="number"
                placeholder="80"
                value={onvifForm.onvifPort}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifPort: parseInt(e.target.value) || 80 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Логин</Label>
              <Input
                placeholder="admin"
                value={onvifForm.onvifUser}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifUser: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Пароль</Label>
              <Input
                type="password"
                placeholder="password"
                value={onvifForm.onvifPass}
                onChange={(e) => setOnvifForm({ ...onvifForm, onvifPass: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Поддержка PTZ</Label>
              <Switch
                checked={onvifForm.hasPtz}
                onCheckedChange={(v) => setOnvifForm({ ...onvifForm, hasPtz: v })}
              />
            </div>
            <Button onClick={handleSaveOnvif} className="w-full" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

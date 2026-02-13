'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  Users,
  AlertTriangle,
  Activity,
  TrendingUp,
  Eye,
  Shield,
  Clock,
  ChevronRight,
  Cpu,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore, useStoreHydrated } from '@/lib/store';
import { venueConfigs } from '@/lib/venue-config';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';
import { useEventStream } from '@/hooks/use-event-stream';
import { useMotionTracker } from '@/hooks/use-motion-tracker';
import { CameraFeed } from '@/components/camera-feed';
import { Go2rtcPlayer } from '@/components/go2rtc-player';
import type { DashboardStats } from '@/lib/types';

interface ApiCamera {
  id: string;
  name: string;
  location: string;
  status: string;
  streamUrl: string;
  isMonitoring: boolean;
}

interface ApiEvent {
  id: string;
  cameraId: string;
  type: string;
  severity: string;
  description: string;
  timestamp: string;
  camera: { name: string; location: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const { selectedVenue, selectedBranchId } = useAppStore();
  const hydrated = useStoreHydrated();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [snapshotTick, setSnapshotTick] = useState(0);
  // Live AI detection state — fed from SSE frame_analyzed events
  const [liveAI, setLiveAI] = useState<{
    totalPeople: number;
    activeCameras: number;
    detFps: number;
    lastUpdate: number;
    perCamera: Record<string, { people: number; detections: number; ts: number }>;
  }>({ totalPeople: 0, activeCameras: 0, detFps: 0, lastUpdate: 0, perCamera: {} });
  const fpsCountRef = useRef(0);
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { hasMotion } = useMotionTracker();

  const fetchData = useCallback(async () => {
    const branchParam = selectedBranchId ? `branchId=${selectedBranchId}` : '';
    try {
      const [statsData, camerasData, eventsData] = await Promise.all([
        apiGet<DashboardStats>(`/api/dashboard/stats?${branchParam}`),
        apiGet<ApiCamera[]>(`/api/cameras?${branchParam}`),
        apiGet<{ events: ApiEvent[] }>(`/api/events?limit=6&${branchParam}`),
      ]);
      setStats(statsData);
      setCameras(camerasData);
      setEvents(eventsData.events);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  }, [selectedBranchId]);

  // Real-time updates via SSE — debounce fetchData, track live detections
  useEventStream(useCallback((event) => {
    if (event.type === 'frame_analyzed' && event.data?.detections) {
      const camId = event.cameraId;
      const peopleCount = Number(event.data.peopleCount) || 0;
      const detCount = Array.isArray(event.data.detections) ? event.data.detections.length : 0;
      fpsCountRef.current++;

      setLiveAI((prev) => {
        const updated = { ...prev.perCamera };
        updated[camId] = { people: peopleCount, detections: detCount, ts: Date.now() };
        // Calculate totals from all cameras (stale > 5s are dropped)
        const now = Date.now();
        let totalPeople = 0;
        let activeCameras = 0;
        for (const [, v] of Object.entries(updated)) {
          if (now - v.ts < 5000) {
            totalPeople += v.people;
            activeCameras++;
          }
        }
        return { ...prev, totalPeople, activeCameras, perCamera: updated, lastUpdate: now };
      });
    }

    // Debounce fetchData — only refresh stats on session/alert events or every 10s
    if (['session_started', 'session_ended', 'alert'].includes(event.type)) {
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
      fetchDebounceRef.current = setTimeout(() => fetchData(), 500);
    }
  }, [fetchData]));

  // FPS counter for AI detections — updates every second
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveAI((prev) => ({ ...prev, detFps: fpsCountRef.current }));
      fpsCountRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh snapshots every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setSnapshotTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setMounted(true);
    if (!selectedVenue) {
      router.push('/select-venue');
      return;
    }
    fetchData();
  }, [hydrated, selectedVenue, selectedBranchId, router, fetchData]);

  if (!mounted || !selectedVenue) return null;

  const venueConfig = venueConfigs.find((v) => v.type === selectedVenue);
  const onlineCameras = stats?.onlineCameras ?? 0;
  const totalCameras = stats?.totalCameras ?? 0;

  const statsCards = [
    {
      title: 'Камеры онлайн',
      value: `${onlineCameras}/${totalCameras}`,
      icon: Camera,
      description: `${totalCameras - onlineCameras} офлайн`,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Обнаружено людей',
      value: String(stats?.peopleDetected ?? 0),
      icon: Users,
      description: 'По данным ИИ-анализа',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Критические события',
      value: String(stats?.criticalEvents ?? 0),
      icon: AlertTriangle,
      description: `${stats?.totalEvents ?? 0} всего событий`,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
    },
    {
      title: 'Средняя загрузка',
      value: stats?.avgOccupancy ? `${stats.avgOccupancy} чел.` : '—',
      icon: Activity,
      description: 'Среднее кол-во людей на кадр',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  const formatTime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Дашборд</h1>
          <p className="text-muted-foreground">
            {venueConfig?.label} — обзор аналитики в реальном времени
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push('/select-venue')}>
          Сменить тип заведения
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', stat.bgColor)}>
                  <stat.icon className={cn('h-5 w-5', stat.color)} />
                </div>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-sm text-muted-foreground">{stat.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Live AI Detection Status */}
      {liveAI.activeCameras > 0 && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <Cpu className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      ИИ-анализ активен
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Детекция объектов в реальном времени
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {liveAI.totalPeople}
                  </div>
                  <p className="text-[10px] text-muted-foreground">людей сейчас</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{liveAI.activeCameras}</div>
                  <p className="text-[10px] text-muted-foreground">камер с AI</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center gap-1">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    <span className="text-2xl font-bold">{liveAI.detFps}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">fps детекции</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Camera Preview Grid */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Камеры</CardTitle>
                <CardDescription>
                  {cameras.length > 0 ? 'Прямая трансляция с камер' : 'Добавьте камеры для начала работы'}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => router.push('/cameras')}>
                Все камеры
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent>
              {cameras.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Camera className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Камеры не добавлены</p>
                  <Button variant="outline" className="mt-4" onClick={() => router.push('/cameras')}>
                    Добавить камеру
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {cameras.slice(0, 4).map((camera) => {
                    const motionActive = hasMotion(camera.id);
                    return (
                      <div
                        key={camera.id}
                        className={cn(
                          'relative rounded-lg border overflow-hidden aspect-video group transition-all duration-300',
                          motionActive
                            ? 'border-green-500 ring-1 ring-green-500 shadow-md shadow-green-500/20'
                            : 'border-border bg-muted/30'
                        )}
                      >
                        {camera.status === 'online' ? (
                          camera.isMonitoring ? (
                            <Go2rtcPlayer
                              streamName={camera.id}
                              className="absolute inset-0 w-full h-full"
                              protocol={camera.streamUrl.toLowerCase().startsWith('rtsp://') ? 'rtsp' : 'http'}
                            />
                          ) : (
                            <CameraFeed
                              cameraId={camera.id}
                              snapshotTick={snapshotTick}
                              className="absolute inset-0 w-full h-full"
                              showFaceDetection={false}
                            />
                          )
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-gray-800/50 to-gray-900/50 flex items-center justify-center">
                            <Camera className="h-8 w-8 text-gray-600" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">{camera.name}</p>
                              <p className="text-xs text-gray-300">{camera.location}</p>
                            </div>
                            <Badge
                              variant={camera.status === 'online' ? 'default' : 'destructive'}
                              className="text-[10px]"
                            >
                              {camera.status === 'online' ? 'LIVE' : 'OFFLINE'}
                            </Badge>
                          </div>
                        </div>
                        {camera.isMonitoring && (
                          <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                            <div className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5">
                              <Eye className="h-3 w-3 text-green-400" />
                              <span className="text-[10px] text-green-400">AI</span>
                            </div>
                          </div>
                        )}
                        {camera.status === 'online' && (
                          <div className="absolute top-2 left-2 z-10">
                            <div className="flex items-center gap-1">
                              <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                              <span className="text-[10px] text-red-400 font-medium">REC</span>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Events */}
        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                События
              </CardTitle>
              <CardDescription>Последние обнаруженные события</CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Нет событий. Начните мониторинг камер для получения событий.
                </div>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div key={event.id} className="flex gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                      <div
                        className={cn(
                          'mt-1 h-2 w-2 rounded-full shrink-0',
                          event.severity === 'critical'
                            ? 'bg-red-500'
                            : event.severity === 'warning'
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug">{event.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{event.camera?.name}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatTime(event.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI Features */}
      <Card>
        <CardHeader>
          <CardTitle>ИИ-функции анализа</CardTitle>
          <CardDescription>
            Активные функции для типа &laquo;{venueConfig?.label}&raquo;
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">Все</TabsTrigger>
              <TabsTrigger value="detection">Детекция</TabsTrigger>
              <TabsTrigger value="counting">Подсчёт</TabsTrigger>
              <TabsTrigger value="tracking">Отслеживание</TabsTrigger>
              <TabsTrigger value="business">Бизнес</TabsTrigger>
              <TabsTrigger value="safety">Безопасность</TabsTrigger>
            </TabsList>
            {['all', 'detection', 'counting', 'tracking', 'business', 'safety'].map((tab) => (
              <TabsContent key={tab} value={tab}>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                  {venueConfig?.features
                    .filter((f) => tab === 'all' || f.category === tab)
                    .map((feature) => (
                      <div
                        key={feature.id}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-4 transition-colors',
                          feature.enabled
                            ? 'border-primary/20 bg-primary/5'
                            : 'border-border bg-muted/30 opacity-60'
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            feature.enabled ? 'bg-primary/10' : 'bg-muted'
                          )}
                        >
                          <Activity className={cn('h-4 w-4', feature.enabled ? 'text-primary' : 'text-muted-foreground')} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{feature.name}</p>
                            {feature.enabled && (
                              <Badge variant="secondary" className="text-[10px] px-1.5">
                                Активно
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Analytics Summary */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-2">Загруженность за день</p>
            <div className="space-y-3">
              {[
                { label: '09:00-12:00', value: 45 },
                { label: '12:00-15:00', value: 85 },
                { label: '15:00-18:00', value: 62 },
                { label: '18:00-21:00', value: 38 },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}%</span>
                  </div>
                  <Progress value={item.value} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-4">Статистика за сегодня</p>
            <div className="space-y-4">
              {[
                { label: 'Всего камер', value: String(stats?.totalCameras ?? 0) },
                { label: 'Онлайн', value: String(stats?.onlineCameras ?? 0) },
                { label: 'Всего событий', value: String(stats?.totalEvents ?? 0) },
                { label: 'Критических', value: String(stats?.criticalEvents ?? 0) },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className="text-sm font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-4">Система</p>
            <div className="space-y-4">
              {[
                {
                  label: 'ИИ-анализ',
                  value: liveAI.activeCameras > 0 ? 'Активен' : (stats?.peopleDetected ? 'Есть данные' : 'Нет данных'),
                  color: liveAI.activeCameras > 0 ? 'text-green-500' : 'text-muted-foreground',
                },
                { label: 'Камеры онлайн', value: `${onlineCameras}/${totalCameras}`, color: onlineCameras > 0 ? 'text-green-500' : 'text-muted-foreground' },
                {
                  label: 'Людей (live)',
                  value: liveAI.activeCameras > 0 ? String(liveAI.totalPeople) : '—',
                  color: liveAI.totalPeople > 0 ? 'text-blue-500' : 'text-muted-foreground',
                },
                {
                  label: 'Детекция FPS',
                  value: liveAI.activeCameras > 0 ? String(liveAI.detFps) : '—',
                  color: liveAI.detFps > 0 ? 'text-yellow-500' : 'text-muted-foreground',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className={cn('text-sm font-semibold', item.color)}>{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

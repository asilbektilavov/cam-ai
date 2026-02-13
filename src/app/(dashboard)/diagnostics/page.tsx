'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Database,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  Camera,
  Bell,
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  MemoryStick,
  Zap,
  Eye,
  Video,
  Users,
  Radio,
  ScanFace,
  Brain,
  Send,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { apiGet } from '@/lib/api-client';
import { toast } from 'sonner';

interface DiagnosticsData {
  overall: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  uptime: number;
  services: {
    database: { status: string; latencyMs: number };
    yolo: { status: string; latencyMs: number; url: string };
    gemini: { status: string };
    go2rtc: { status: string; activeStreams: number };
    attendance: {
      status: string;
      latencyMs: number;
      employeesLoaded: number;
      cameras: Array<{
        id: string;
        direction: string;
        alive: boolean;
        fps: number;
        facesDetected: number;
        matchesFound: number;
      }>;
    };
  };
  system: {
    cpuModel: string;
    cpuCores: number;
    loadAvg: number[];
    memoryTotal: number;
    memoryUsed: number;
    memoryPercent: number;
    diskTotal: number;
    diskUsed: number;
    diskPercent: number;
    platform: string;
    nodeVersion: string;
  };
  cameras: {
    total: number;
    online: number;
    monitoring: number;
    byPurpose: {
      detection: number;
      attendanceEntry: number;
      attendanceExit: number;
    };
  };
  events: {
    last24h: number;
    lastHour: number;
    criticalLast24h: number;
    byType: Array<{ type: string; count: number }>;
  };
  sessions: {
    active: number;
  };
  notifications: {
    sentLast24h: number;
    failedLast24h: number;
  };
  integrations: Array<{
    type: string;
    name: string;
    enabled: boolean;
    lastUpdated: string;
  }>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok' || status === 'healthy' || status === 'configured') {
    return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  }
  if (status === 'degraded' || status === 'offline' || status === 'not_configured') {
    return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
  }
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok: 'bg-green-500/15 text-green-600 border-green-500/30',
    healthy: 'bg-green-500/15 text-green-600 border-green-500/30',
    configured: 'bg-green-500/15 text-green-600 border-green-500/30',
    degraded: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
    offline: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
    not_configured: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
    error: 'bg-red-500/15 text-red-600 border-red-500/30',
    critical: 'bg-red-500/15 text-red-600 border-red-500/30',
  };

  const labels: Record<string, string> = {
    ok: 'Работает',
    healthy: 'Здоров',
    configured: 'Настроен',
    degraded: 'Деградация',
    offline: 'Оффлайн',
    not_configured: 'Не настроен',
    error: 'Ошибка',
    critical: 'Критично',
  };

  return (
    <Badge className={styles[status] || styles.error}>
      {labels[status] || status}
    </Badge>
  );
}

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchDiagnostics = useCallback(async () => {
    try {
      const result = await apiGet<DiagnosticsData>('/api/diagnostics');
      setData(result);
    } catch {
      toast.error('Ошибка загрузки диагностики');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagnostics();
  }, [fetchDiagnostics]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchDiagnostics, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchDiagnostics]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Диагностика системы</h1>
          <p className="text-muted-foreground">Мониторинг здоровья и производительности</p>
        </div>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Диагностика системы</h1>
          <p className="text-muted-foreground">Мониторинг здоровья и производительности</p>
        </div>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-2">Не удалось загрузить данные диагностики</h2>
            <p className="text-sm text-muted-foreground mb-4">Проверьте подключение к серверу и повторите попытку</p>
            <Button variant="outline" onClick={() => { setLoading(true); fetchDiagnostics(); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Повторить
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Диагностика системы</h1>
          <p className="text-muted-foreground">Мониторинг здоровья и производительности</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? 'Авто-обновление вкл.' : 'Авто-обновление выкл.'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchDiagnostics()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>
      </div>

      {/* Overall Status */}
      <Card className={
        data.overall === 'healthy' ? 'border-green-500/30 bg-green-500/5' :
        data.overall === 'degraded' ? 'border-yellow-500/30 bg-yellow-500/5' :
        'border-red-500/30 bg-red-500/5'
      }>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <StatusIcon status={data.overall} />
              <div>
                <h2 className="text-lg font-semibold">
                  {data.overall === 'healthy' ? 'Система работает нормально' :
                   data.overall === 'degraded' ? 'Система работает с ограничениями' :
                   'Критическая проблема'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Аптайм: {formatUptime(data.uptime)} | Последняя проверка: {new Date(data.timestamp).toLocaleTimeString('ru-RU')}
                </p>
              </div>
            </div>
            <StatusBadge status={data.overall} />
          </div>
        </CardContent>
      </Card>

      {/* Services */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {/* Database */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              База данных
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <StatusBadge status={data.services.database.status} />
              <span className="text-sm text-muted-foreground">
                {data.services.database.latencyMs}мс
              </span>
            </div>
          </CardContent>
        </Card>

        {/* YOLO Service */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Детекция объектов
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <StatusBadge status={data.services.yolo.status} />
              <span className="text-sm text-muted-foreground">
                {data.services.yolo.status === 'ok' ? `${data.services.yolo.latencyMs}мс` : 'Недоступен'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Gemini */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              AI-аналитика
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={data.services.gemini.status} />
          </CardContent>
        </Card>

        {/* go2rtc */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Video className="h-4 w-4" />
              Видеостриминг
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <StatusBadge status={data.services.go2rtc.status} />
              <span className="text-sm text-muted-foreground">
                {data.services.go2rtc.activeStreams} потоков
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Attendance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ScanFace className="h-4 w-4" />
              Распознавание
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <StatusBadge status={data.services.attendance.status} />
              <span className="text-sm text-muted-foreground">
                {data.services.attendance.status === 'ok' ? `${data.services.attendance.latencyMs}мс` : 'Недоступен'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Service Load — single segmented bar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Нагрузка по функциям
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(() => {
            const segments = [
              { key: 'streaming', label: 'Видеостриминг', color: 'bg-blue-500', value: data.services.go2rtc.activeStreams },
              { key: 'detection', label: 'Детекция объектов', color: 'bg-violet-500', value: data.cameras.monitoring },
              { key: 'faces', label: 'Распознавание лиц', color: 'bg-emerald-500', value: data.services.attendance.cameras.filter((c) => c.alive).length },
              { key: 'ai', label: 'AI-аналитика', color: 'bg-amber-500', value: data.sessions.active },
              { key: 'notifications', label: 'Уведомления', color: 'bg-pink-500', value: data.notifications.sentLast24h },
            ];
            const total = segments.reduce((s, seg) => s + seg.value, 0);

            return (
              <>
                {/* Segmented bar */}
                <div className="h-5 rounded-full bg-muted overflow-hidden flex">
                  {total > 0 ? (
                    segments
                      .filter((s) => s.value > 0)
                      .map((s, i, arr) => (
                        <div
                          key={s.key}
                          className={`h-full ${s.color} transition-all duration-500 ${i === 0 ? 'rounded-l-full' : ''} ${i === arr.length - 1 ? 'rounded-r-full' : ''}`}
                          style={{ width: `${(s.value / total) * 100}%` }}
                          title={`${s.label}: ${s.value}`}
                        />
                      ))
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                      Нет активных функций
                    </div>
                  )}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {segments.map((s) => (
                    <div key={s.key} className="flex items-center gap-2 text-sm">
                      <div className={`h-3 w-3 rounded-full ${s.color} ${s.value === 0 ? 'opacity-30' : ''}`} />
                      <span className={s.value === 0 ? 'text-muted-foreground' : ''}>
                        {s.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* Event Type Distribution */}
      {data.events.byType.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4" />
              Распределение событий за 24ч
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const maxCount = Math.max(...data.events.byType.map((e) => e.count), 1);
              const typeLabels: Record<string, string> = {
                person_detected: 'Обнаружение людей',
                motion_detected: 'Движение',
                face_detected: 'Распознавание лиц',
                fire_detected: 'Обнаружение огня',
                anomaly: 'Аномалия',
                line_crossing: 'Пересечение линии',
                loitering: 'Задержка в зоне',
                abandoned_object: 'Оставленный предмет',
                fall_detected: 'Падение',
                tamper_detected: 'Саботаж камеры',
                crowd: 'Скопление людей',
                vehicle: 'Транспорт',
              };
              const typeColors: Record<string, string> = {
                person_detected: 'bg-blue-500',
                motion_detected: 'bg-slate-400',
                face_detected: 'bg-emerald-500',
                fire_detected: 'bg-red-500',
                anomaly: 'bg-orange-500',
                line_crossing: 'bg-yellow-500',
                loitering: 'bg-purple-500',
                abandoned_object: 'bg-amber-600',
                fall_detected: 'bg-rose-500',
                tamper_detected: 'bg-red-700',
                crowd: 'bg-indigo-500',
                vehicle: 'bg-teal-500',
              };
              const sorted = [...data.events.byType].sort((a, b) => b.count - a.count);
              return sorted.map((evt) => (
                <div key={evt.type} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${typeColors[evt.type] || 'bg-gray-400'}`} />
                      <span>{typeLabels[evt.type] || evt.type}</span>
                    </div>
                    <span className="font-medium tabular-nums">{evt.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${typeColors[evt.type] || 'bg-gray-400'}`}
                      style={{ width: `${(evt.count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
              ));
            })()}
          </CardContent>
        </Card>
      )}

      {/* Attendance Service Details */}
      {data.services.attendance.status === 'ok' && data.services.attendance.cameras.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanFace className="h-4 w-4" />
              Детализация распознавания лиц
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                <span><Users className="h-4 w-4 inline mr-1" />Загружено людей: <strong className="text-foreground">{data.services.attendance.employeesLoaded}</strong></span>
              </div>
              {data.services.attendance.cameras.map((cam) => (
                <div key={cam.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${cam.alive ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div>
                      <p className="text-sm font-medium">
                        {cam.direction === 'entry' ? 'Вход' : cam.direction === 'exit' ? 'Выход' : cam.direction}
                      </p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{cam.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{cam.fps} FPS</span>
                    <span>{cam.facesDetected} лиц</span>
                    <span className="text-emerald-500">{cam.matchesFound} совпадений</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Resources */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* CPU */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Процессор
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{data.system.cpuModel}</p>
            <div className="flex items-center justify-between text-sm">
              <span>{data.system.cpuCores} ядер</span>
              <span>Нагрузка: {data.system.loadAvg.join(' / ')}</span>
            </div>
            <Progress
              value={Math.min((data.system.loadAvg[0] / data.system.cpuCores) * 100, 100)}
              className="h-2"
            />
          </CardContent>
        </Card>

        {/* Memory */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MemoryStick className="h-4 w-4" />
              Оперативная память
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{formatBytes(data.system.memoryUsed)} / {formatBytes(data.system.memoryTotal)}</span>
              <span className={
                data.system.memoryPercent > 90 ? 'text-red-500' :
                data.system.memoryPercent > 70 ? 'text-yellow-500' : 'text-green-500'
              }>
                {data.system.memoryPercent}%
              </span>
            </div>
            <Progress value={data.system.memoryPercent} className="h-2" />
          </CardContent>
        </Card>

        {/* Disk */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Диск
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{formatBytes(data.system.diskUsed)} / {formatBytes(data.system.diskTotal)}</span>
              <span className={
                data.system.diskPercent > 90 ? 'text-red-500' :
                data.system.diskPercent > 70 ? 'text-yellow-500' : 'text-green-500'
              }>
                {data.system.diskPercent}%
              </span>
            </div>
            <Progress value={data.system.diskPercent} className="h-2" />
          </CardContent>
        </Card>

        {/* Cameras */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Камеры
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{data.cameras.total}</p>
                <p className="text-xs text-muted-foreground">Всего</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-500">{data.cameras.online}</p>
                <p className="text-xs text-muted-foreground">Онлайн</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-500">{data.cameras.monitoring}</p>
                <p className="text-xs text-muted-foreground">Мониторинг</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Activity className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Событий / 24ч</p>
                <p className="text-xl font-bold">{data.events.last24h}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Критических / 24ч</p>
                <p className="text-xl font-bold">{data.events.criticalLast24h}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <Bell className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Уведомлений отправлено</p>
                <p className="text-xl font-bold">{data.notifications.sentLast24h}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Неудачных уведомлений</p>
                <p className="text-xl font-bold">{data.notifications.failedLast24h}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Активные сессии анализа: {data.sessions.active}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {data.sessions.active > 0
              ? `Камеры ведут анализ. Событий за последний час: ${data.events.lastHour}`
              : 'Нет активных сессий анализа'}
          </p>
        </CardContent>
      </Card>

      {/* Integrations Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            Интеграции
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.integrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет настроенных интеграций</p>
          ) : (
            <div className="space-y-2">
              {data.integrations.map((int) => (
                <div
                  key={int.type}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {int.enabled ? (
                      <Wifi className="h-4 w-4 text-green-500" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{int.name}</p>
                      <p className="text-xs text-muted-foreground">{int.type}</p>
                    </div>
                  </div>
                  <Badge variant={int.enabled ? 'default' : 'secondary'}>
                    {int.enabled ? 'Активна' : 'Отключена'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Системная информация
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Платформа</p>
              <p className="font-medium">{data.system.platform}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Node.js</p>
              <p className="font-medium">{data.system.nodeVersion}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Процессор</p>
              <p className="font-medium">{data.system.cpuCores} ядер</p>
            </div>
            <div>
              <p className="text-muted-foreground">Аптайм</p>
              <p className="font-medium">{formatUptime(data.uptime)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

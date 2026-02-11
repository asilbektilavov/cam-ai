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
  };
  events: {
    last24h: number;
    lastHour: number;
    criticalLast24h: number;
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
      <div className="grid gap-4 md:grid-cols-3">
        {/* Database */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              База данных (PostgreSQL)
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
              YOLO Детекция
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
              Gemini AI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={data.services.gemini.status} />
          </CardContent>
        </Card>
      </div>

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

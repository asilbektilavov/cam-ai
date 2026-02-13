'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Users,
  Clock,
  Eye,
  AlertTriangle,
  Calendar,
  Download,
  Filter,
  Check,
  Loader2,
  Activity,
  Camera,
  MapPin,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import AnalyticsHeatmap from '@/components/analytics-heatmap';
import PeopleCounterWidget from '@/components/people-counter-widget';

interface AnalyticsData {
  period: string;
  totalEvents: number;
  totalPeopleDetected: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: { critical: number; warning: number; info: number };
  hourlyData: { hour: string; count: number }[];
  totalSessions: number;
  activeSessions: number;
  totalFrames: number;
  eventsByCamera: { cameraName: string; count: number }[];
  recentEvents: {
    id: string;
    type: string;
    severity: string;
    description: string;
    timestamp: string;
    cameraName: string;
    cameraLocation: string;
  }[];
  comparison: {
    events: { current: number; previous: number };
    sessions: { current: number; previous: number };
  };
}

const periodLabels: Record<string, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: 'Эта неделя',
  month: 'Этот месяц',
};

const typeLabels: Record<string, string> = {
  motion_detected: 'Детекция движения',
  alert: 'Алерт безопасности',
  face_detected: 'Распознавание лиц',
  people_count: 'Подсчёт людей',
  suspicious_behavior: 'Подозрительное поведение',
  queue_detected: 'Длинная очередь',
  fire: 'Обнаружение огня',
  smoke: 'Обнаружение дыма',
  ppe_violation: 'Нарушение СИЗ',
  blacklist_plate: 'Номер из чёрного списка',
  line_crossing: 'Пересечение линии',
  abandoned_object: 'Оставленный предмет',
  tamper: 'Саботаж камеры',
  intrusion: 'Несанкционированный доступ',
  crowd: 'Скопление людей',
  fall: 'Обнаружение падения',
};

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const { selectedBranchId } = useAppStore();

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const branchParam = selectedBranchId ? `&branchId=${selectedBranchId}` : '';
      const result = await apiGet<AnalyticsData>(`/api/analytics?period=${period}${branchParam}`);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [period, selectedBranchId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const toggleFilter = (filter: string) => {
    setActiveFilters((prev) =>
      prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
    );
    toast.success('Фильтры обновлены');
  };

  const handleExport = (format: string) => {
    const formatMap: Record<string, string> = {
      CSV: 'csv',
      JSON: 'json',
      PDF: 'pdf',
      Excel: 'xlsx',
    };
    const ext = formatMap[format] || format.toLowerCase();
    const link = document.createElement('a');
    link.href = `/api/analytics/export?format=${ext}&period=${period}`;
    link.download = `analytics-${period}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`${format}-файл скачивается`);
  };

  const formatTime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
  };

  const getChangePercent = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+100%' : '0%';
    const change = Math.round(((current - previous) / previous) * 100);
    return change >= 0 ? `+${change}%` : `${change}%`;
  };

  const maxHourlyCount = data ? Math.max(...data.hourlyData.map((h) => h.count), 1) + 1 : 2;

  // Filter events by selected types
  const filteredEvents = data?.recentEvents.filter((e) => {
    if (activeFilters.length === 0) return true;
    return activeFilters.some((f) => e.type.includes(f));
  }) ?? [];

  // Event type stats
  const eventTypeStats = data ? Object.entries(data.eventsByType).map(([type, count]) => ({
    type: typeLabels[type] || type,
    count,
  })).sort((a, b) => b.count - a.count) : [];

  const maxEventCount = eventTypeStats.length > 0 ? Math.max(...eventTypeStats.map((e) => e.count)) : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Аналитика</h1>
          <p className="text-muted-foreground">Детальная статистика и отчёты</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filters */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Фильтры
                {activeFilters.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                    {activeFilters.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {[
                { id: 'motion', label: 'Детекция движения' },
                { id: 'alert', label: 'Алерты' },
                { id: 'face', label: 'Распознавание лиц' },
                { id: 'suspicious', label: 'Подозрительное поведение' },
              ].map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  onClick={() => toggleFilter(f.id)}
                  className="cursor-pointer"
                >
                  <div className={cn(
                    'mr-2 h-4 w-4 rounded border flex items-center justify-center',
                    activeFilters.includes(f.id) ? 'bg-primary border-primary' : 'border-muted-foreground'
                  )}>
                    {activeFilters.includes(f.id) && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  {f.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Period */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Calendar className="h-4 w-4" />
                {periodLabels[period]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(periodLabels).map(([key, label]) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => setPeriod(key)}
                  className="cursor-pointer"
                >
                  {key === period && <Check className="h-4 w-4 mr-2" />}
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Экспорт
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('PDF')} className="cursor-pointer">
                Экспорт в PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('Excel')} className="cursor-pointer">
                Экспорт в Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('CSV')} className="cursor-pointer">
                Экспорт в CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('JSON')} className="cursor-pointer">
                Экспорт в JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <div className="text-center py-12 text-muted-foreground">Не удалось загрузить данные</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Всего событий',
                value: data.totalEvents.toLocaleString(),
                change: getChangePercent(data.comparison.events.current, data.comparison.events.previous),
                up: data.comparison.events.current >= data.comparison.events.previous,
                icon: AlertTriangle,
              },
              {
                label: 'Обнаружено людей',
                value: data.totalPeopleDetected.toLocaleString(),
                change: data.totalPeopleDetected > 0 ? '+' : '',
                up: true,
                icon: Users,
              },
              {
                label: 'Сессий анализа',
                value: data.totalSessions.toLocaleString(),
                change: getChangePercent(data.comparison.sessions.current, data.comparison.sessions.previous),
                up: data.comparison.sessions.current >= data.comparison.sessions.previous,
                icon: Activity,
              },
              {
                label: 'Кадров обработано',
                value: data.totalFrames.toLocaleString(),
                change: data.activeSessions > 0 ? `${data.activeSessions} активных` : 'Нет активных',
                up: data.activeSessions > 0,
                icon: Camera,
              },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <kpi.icon className="h-5 w-5 text-muted-foreground" />
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs',
                        kpi.up ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {kpi.up ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                      {kpi.change}
                    </Badge>
                  </div>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="events">События</TabsTrigger>
              <TabsTrigger value="cameras">По камерам</TabsTrigger>
              <TabsTrigger value="severity">По важности</TabsTrigger>
              <TabsTrigger value="heatmap">
                <MapPin className="h-4 w-4 mr-1" />
                Тепловая карта
              </TabsTrigger>
              <TabsTrigger value="people">
                <Users className="h-4 w-4 mr-1" />
                Подсчёт людей
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab - Hourly chart */}
            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Активность по часам
                  </CardTitle>
                  <CardDescription>Количество событий по часам за {periodLabels[period].toLowerCase()}</CardDescription>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  {data.hourlyData.every((h) => h.count === 0) ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Activity className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">Нет данных за выбранный период</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Начните мониторинг камер для сбора статистики
                      </p>
                    </div>
                  ) : (
                    (() => {
                      const W = 960, H = 300, PL = 46, PR = 8, PT = 12, PB = 36;
                      const chartW = W - PL - PR, chartH = H - PT - PB;
                      const baseline = PT + chartH; // y=0 line
                      const pts = data.hourlyData.map((item, i) => ({
                        x: PL + (i / Math.max(data.hourlyData.length - 1, 1)) * chartW,
                        y: baseline - (item.count / maxHourlyCount) * chartH,
                        ...item,
                      }));
                      // Catmull-Rom → cubic bezier, clamped so curve never dips below baseline
                      const catmull = (p: typeof pts) => {
                        if (p.length < 2) return `M${p[0].x},${p[0].y}`;
                        let d = `M${p[0].x},${p[0].y}`;
                        for (let i = 0; i < p.length - 1; i++) {
                          const p0 = p[Math.max(i - 1, 0)];
                          const p1 = p[i];
                          const p2 = p[i + 1];
                          const p3 = p[Math.min(i + 2, p.length - 1)];
                          const cp1x = p1.x + (p2.x - p0.x) / 6;
                          const cp1y = Math.min(p1.y + (p2.y - p0.y) / 6, baseline);
                          const cp2x = p2.x - (p3.x - p1.x) / 6;
                          const cp2y = Math.min(p2.y - (p3.y - p1.y) / 6, baseline);
                          d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
                        }
                        return d;
                      };
                      const curvePath = catmull(pts);
                      const areaPath = `${curvePath} L${pts[pts.length - 1].x},${baseline} L${pts[0].x},${baseline} Z`;
                      // Integer grid steps to avoid duplicate labels
                      const yTicks: number[] = [];
                      const tickStep = maxHourlyCount <= 5 ? 1 : maxHourlyCount <= 20 ? Math.ceil(maxHourlyCount / 5) : Math.ceil(maxHourlyCount / 6);
                      for (let v = 0; v <= maxHourlyCount; v += tickStep) yTicks.push(v);
                      const labelStep = pts.length > 16 ? 2 : 1;
                      return (
                        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 420 }}>
                          {/* Y axis label */}
                          <text x={10} y={PT + chartH / 2} textAnchor="middle" className="fill-muted-foreground" fontSize={10} transform={`rotate(-90, 10, ${PT + chartH / 2})`}>
                            Кол-во событий
                          </text>
                          {/* X axis label */}
                          <text x={PL + chartW / 2} y={H - 2} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                            Час
                          </text>
                          {/* Grid lines + Y values */}
                          {yTicks.map((v) => {
                            const y = baseline - (v / maxHourlyCount) * chartH;
                            return (
                              <g key={v}>
                                <line x1={PL} y1={y} x2={PL + chartW} y2={y} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                                <text x={PL - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                                  {v}
                                </text>
                              </g>
                            );
                          })}
                          {/* Axis lines */}
                          <line x1={PL} y1={PT} x2={PL} y2={baseline} stroke="currentColor" strokeOpacity={0.15} />
                          <line x1={PL} y1={baseline} x2={PL + chartW} y2={baseline} stroke="currentColor" strokeOpacity={0.15} />
                          <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                            </linearGradient>
                            <clipPath id="chartClip">
                              <rect x={PL} y={PT} width={chartW} height={chartH} />
                            </clipPath>
                          </defs>
                          <g clipPath="url(#chartClip)">
                            <path d={areaPath} fill="url(#areaGrad)" />
                            <path d={curvePath} fill="none" stroke="hsl(217, 91%, 60%)" strokeWidth={2} strokeLinecap="round" />
                          </g>
                          {/* X labels */}
                          {pts.map((p, i) => (
                            i % labelStep === 0 ? (
                              <text key={p.hour} x={p.x} y={baseline + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                                {p.hour}
                              </text>
                            ) : null
                          ))}
                        </svg>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
              <div className="h-40" />
            </TabsContent>

            {/* Events Tab - Event type breakdown */}
            <TabsContent value="events" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Статистика по типам событий</CardTitle>
                  <CardDescription>Распределение событий по типам</CardDescription>
                </CardHeader>
                <CardContent>
                  {eventTypeStats.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      Нет событий за выбранный период
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {eventTypeStats.map((event) => (
                        <div key={event.type} className="flex items-center gap-4">
                          <span className="text-sm w-56 shrink-0">{event.type}</span>
                          <div className="flex-1">
                            <Progress
                              value={(event.count / maxEventCount) * 100}
                              className="h-3"
                            />
                          </div>
                          <span className="text-sm font-semibold w-16 text-right">{event.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent events log */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Журнал событий
                  </CardTitle>
                  <CardDescription>Последние события ({filteredEvents.length})</CardDescription>
                </CardHeader>
                <CardContent>
                  {filteredEvents.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      Нет событий за выбранный период
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {filteredEvents.map((event) => (
                        <div key={event.id} className="flex gap-3 pb-3 border-b border-border last:border-0">
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
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span>{event.cameraName}</span>
                              <span>{formatTime(event.timestamp)}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {typeLabels[event.type] || event.type}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cameras Tab */}
            <TabsContent value="cameras" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Активность по камерам
                  </CardTitle>
                  <CardDescription>Количество событий по каждой камере</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.eventsByCamera.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      Нет данных за выбранный период
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.eventsByCamera.map((cam) => {
                        const maxCam = Math.max(...data.eventsByCamera.map((c) => c.count));
                        return (
                          <div key={cam.cameraName} className="flex items-center gap-4">
                            <span className="text-sm w-48 shrink-0">{cam.cameraName}</span>
                            <div className="flex-1 h-8 bg-muted rounded-md overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-md transition-all flex items-center px-2"
                                style={{ width: `${Math.max((cam.count / maxCam) * 100, 5)}%` }}
                              >
                                <span className="text-xs font-medium text-white">{cam.count}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Severity Tab */}
            <TabsContent value="severity" className="space-y-6">
              <div className="grid sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-6 text-center">
                    <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-red-500/10 mb-3">
                      <AlertTriangle className="h-6 w-6 text-red-500" />
                    </div>
                    <p className="text-3xl font-bold text-red-500">{data.eventsBySeverity.critical}</p>
                    <p className="text-sm text-muted-foreground mt-1">Критических</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6 text-center">
                    <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-yellow-500/10 mb-3">
                      <AlertTriangle className="h-6 w-6 text-yellow-500" />
                    </div>
                    <p className="text-3xl font-bold text-yellow-500">{data.eventsBySeverity.warning}</p>
                    <p className="text-sm text-muted-foreground mt-1">Предупреждений</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6 text-center">
                    <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-blue-500/10 mb-3">
                      <Eye className="h-6 w-6 text-blue-500" />
                    </div>
                    <p className="text-3xl font-bold text-blue-500">{data.eventsBySeverity.info}</p>
                    <p className="text-sm text-muted-foreground mt-1">Информационных</p>
                  </CardContent>
                </Card>
              </div>

              {/* Severity distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Распределение по важности</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.totalEvents === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      Нет событий за выбранный период
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {[
                        { label: 'Критические', count: data.eventsBySeverity.critical, color: 'bg-red-500' },
                        { label: 'Предупреждения', count: data.eventsBySeverity.warning, color: 'bg-yellow-500' },
                        { label: 'Информационные', count: data.eventsBySeverity.info, color: 'bg-blue-500' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-4">
                          <span className="text-sm w-40 shrink-0">{item.label}</span>
                          <div className="flex-1 h-6 bg-muted rounded-md overflow-hidden">
                            <div
                              className={cn('h-full rounded-md flex items-center px-2', item.color)}
                              style={{ width: `${Math.max((item.count / data.totalEvents) * 100, 2)}%` }}
                            >
                              {item.count > 0 && (
                                <span className="text-xs font-medium text-white">{item.count}</span>
                              )}
                            </div>
                          </div>
                          <span className="text-sm font-semibold w-16 text-right">
                            {data.totalEvents > 0 ? Math.round((item.count / data.totalEvents) * 100) : 0}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Heatmap Tab */}
            <TabsContent value="heatmap" className="space-y-6">
              <AnalyticsHeatmap />
            </TabsContent>

            {/* People Counter Tab */}
            <TabsContent value="people" className="space-y-6">
              <PeopleCounterSection />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

/**
 * People Counter section - fetches cameras and renders a widget per camera.
 */
function PeopleCounterSection() {
  const [cameras, setCameras] = useState<{ id: string; name: string; location: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedBranchId } = useAppStore();

  useEffect(() => {
    async function loadCameras() {
      try {
        const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
        const result = await apiGet<{ id: string; name: string; location: string }[]>(
          `/api/cameras${branchParam}`
        );
        setCameras(result);
      } catch (err) {
        console.error('[PeopleCounterSection] Failed to fetch cameras:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCameras();
  }, [selectedBranchId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Нет доступных камер</p>
          <p className="text-sm text-muted-foreground mt-1">
            Добавьте камеры для подсчёта людей
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {cameras.map((camera) => (
        <PeopleCounterWidget
          key={camera.id}
          cameraId={camera.id}
          cameraName={camera.name}
        />
      ))}
    </div>
  );
}

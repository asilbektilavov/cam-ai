'use client';

import { useState } from 'react';
import {
  BarChart3,
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

const hourlyData = [
  { hour: '06', visitors: 12, percentage: 8 },
  { hour: '07', visitors: 23, percentage: 15 },
  { hour: '08', visitors: 45, percentage: 30 },
  { hour: '09', visitors: 67, percentage: 45 },
  { hour: '10', visitors: 89, percentage: 59 },
  { hour: '11', visitors: 112, percentage: 75 },
  { hour: '12', visitors: 134, percentage: 89 },
  { hour: '13', visitors: 150, percentage: 100 },
  { hour: '14', visitors: 128, percentage: 85 },
  { hour: '15', visitors: 98, percentage: 65 },
  { hour: '16', visitors: 76, percentage: 51 },
  { hour: '17', visitors: 54, percentage: 36 },
  { hour: '18', visitors: 43, percentage: 29 },
  { hour: '19', visitors: 32, percentage: 21 },
  { hour: '20', visitors: 18, percentage: 12 },
  { hour: '21', visitors: 8, percentage: 5 },
];

const zoneHeatmap = [
  { zone: 'Главный вход', activity: 95, color: 'bg-red-500' },
  { zone: 'Торговый зал (центр)', activity: 82, color: 'bg-orange-500' },
  { zone: 'Кассовая зона', activity: 78, color: 'bg-orange-400' },
  { zone: 'Зона электроники', activity: 65, color: 'bg-yellow-500' },
  { zone: 'Зона продуктов', activity: 58, color: 'bg-yellow-400' },
  { zone: 'Примерочные', activity: 42, color: 'bg-green-400' },
  { zone: 'Складская зона', activity: 25, color: 'bg-green-500' },
  { zone: 'Запасный выход', activity: 12, color: 'bg-blue-500' },
];

const eventsByType = [
  { type: 'Детекция движения', count: 456, trend: '+12%', up: true },
  { type: 'Подсчёт посетителей', count: 1247, trend: '+8%', up: true },
  { type: 'Подозрительное поведение', count: 3, trend: '-40%', up: false },
  { type: 'Длинная очередь', count: 18, trend: '+25%', up: true },
  { type: 'Нарушение периметра', count: 1, trend: '-67%', up: false },
  { type: 'Распознавание лиц', count: 89, trend: '+15%', up: true },
];

const weeklyComparison = [
  { day: 'Пн', current: 1120, previous: 980 },
  { day: 'Вт', current: 1080, previous: 1050 },
  { day: 'Ср', current: 1247, previous: 1100 },
  { day: 'Чт', current: 0, previous: 1200 },
  { day: 'Пт', current: 0, previous: 1350 },
  { day: 'Сб', current: 0, previous: 1500 },
  { day: 'Вс', current: 0, previous: 890 },
];

const periodLabels: Record<string, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: 'Эта неделя',
  month: 'Этот месяц',
};

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('today');
  const [activeFilters, setActiveFilters] = useState<string[]>(['motion', 'people', 'faces']);

  const toggleFilter = (filter: string) => {
    setActiveFilters((prev) =>
      prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
    );
    toast.success('Фильтры обновлены');
  };

  const handleExport = (format: string) => {
    toast.success(`Экспорт в ${format} начат. Файл скачается автоматически.`);
  };

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
                { id: 'people', label: 'Подсчёт людей' },
                { id: 'faces', label: 'Распознавание лиц' },
                { id: 'suspicious', label: 'Подозрительное поведение' },
                { id: 'queue', label: 'Очереди' },
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
                  onClick={() => {
                    setPeriod(key);
                    toast.info(`Период: ${label}`);
                  }}
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
              <DropdownMenuItem onClick={() => handleExport('CSV')} className="cursor-pointer">
                Экспорт в CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('Excel')} className="cursor-pointer">
                Экспорт в Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Посетителей сегодня',
            value: '1,247',
            change: '+12%',
            up: true,
            icon: Users,
          },
          {
            label: 'Среднее время визита',
            value: '24 мин',
            change: '+3 мин',
            up: true,
            icon: Clock,
          },
          {
            label: 'Конверсия',
            value: '34%',
            change: '+5%',
            up: true,
            icon: TrendingUp,
          },
          {
            label: 'Инцидентов',
            value: '3',
            change: '-40%',
            up: false,
            icon: AlertTriangle,
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
          <TabsTrigger value="heatmap">Тепловая карта</TabsTrigger>
          <TabsTrigger value="events">События</TabsTrigger>
          <TabsTrigger value="comparison">Сравнение</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Посещаемость по часам
              </CardTitle>
              <CardDescription>Количество обнаруженных посетителей за сегодня</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1.5 h-48">
                {hourlyData.map((item) => (
                  <div key={item.hour} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{item.visitors}</span>
                    <div
                      className={cn(
                        'w-full rounded-t-sm transition-all',
                        item.percentage > 80
                          ? 'bg-red-500'
                          : item.percentage > 60
                          ? 'bg-orange-500'
                          : item.percentage > 40
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                      )}
                      style={{ height: `${Math.max(item.percentage, 3)}%` }}
                    />
                    <span className="text-[10px] text-muted-foreground">{item.hour}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Heatmap Tab */}
        <TabsContent value="heatmap" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Активность по зонам
              </CardTitle>
              <CardDescription>Уровень активности в различных зонах помещения</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {zoneHeatmap.map((zone) => (
                  <div key={zone.zone} className="flex items-center gap-4">
                    <span className="text-sm w-48 shrink-0">{zone.zone}</span>
                    <div className="flex-1 h-8 bg-muted rounded-md overflow-hidden">
                      <div
                        className={cn('h-full rounded-md transition-all flex items-center px-2', zone.color)}
                        style={{ width: `${zone.activity}%` }}
                      >
                        <span className="text-xs font-medium text-white">{zone.activity}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Simulated Heatmap Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Визуальная тепловая карта</CardTitle>
              <CardDescription>Схематичное представление активности</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-8 gap-1 aspect-[2/1]">
                {Array.from({ length: 64 }, (_, i) => {
                  const intensity = Math.random();
                  return (
                    <div
                      key={i}
                      className={cn(
                        'rounded-sm',
                        intensity > 0.8
                          ? 'bg-red-500/80'
                          : intensity > 0.6
                          ? 'bg-orange-500/60'
                          : intensity > 0.4
                          ? 'bg-yellow-500/40'
                          : intensity > 0.2
                          ? 'bg-green-500/30'
                          : 'bg-blue-500/20'
                      )}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-sm bg-blue-500/20" />
                  Низкая
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-sm bg-green-500/30" />
                  Средняя
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-sm bg-yellow-500/40" />
                  Высокая
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-sm bg-red-500/80" />
                  Максимальная
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Статистика событий</CardTitle>
              <CardDescription>Количество обнаруженных событий по типам за сегодня</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {eventsByType.map((event) => (
                  <div key={event.type} className="flex items-center gap-4">
                    <span className="text-sm w-56 shrink-0">{event.type}</span>
                    <div className="flex-1">
                      <Progress
                        value={(event.count / Math.max(...eventsByType.map((e) => e.count))) * 100}
                        className="h-3"
                      />
                    </div>
                    <span className="text-sm font-semibold w-16 text-right">{event.count}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs w-16 justify-center',
                        event.up
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {event.trend}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Comparison Tab */}
        <TabsContent value="comparison" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Сравнение по дням</CardTitle>
              <CardDescription>Текущая неделя vs. прошлая неделя</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {weeklyComparison.map((day) => (
                  <div key={day.day} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium w-8">{day.day}</span>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Текущая: {day.current || '—'}</span>
                        <span>Прошлая: {day.previous}</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-sm"
                          style={{ width: `${(day.current / 1500) * 100}%` }}
                        />
                      </div>
                      <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-muted-foreground/30 rounded-sm"
                          style={{ width: `${(day.previous / 1500) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-6 mt-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-sm bg-blue-500" />
                  Текущая неделя
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-sm bg-muted-foreground/30" />
                  Прошлая неделя
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

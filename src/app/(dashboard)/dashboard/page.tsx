'use client';

import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/lib/store';
import { venueConfigs } from '@/lib/venue-config';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const router = useRouter();
  const { selectedVenue, cameras, events } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!selectedVenue) {
      router.push('/select-venue');
    }
  }, [selectedVenue, router]);

  if (!mounted || !selectedVenue) return null;

  const venueConfig = venueConfigs.find((v) => v.type === selectedVenue);
  const onlineCameras = cameras.filter((c) => c.status === 'online').length;
  const criticalEvents = events.filter((e) => e.severity === 'critical').length;
  const warningEvents = events.filter((e) => e.severity === 'warning').length;

  const statsCards = [
    {
      title: 'Камеры онлайн',
      value: `${onlineCameras}/${cameras.length}`,
      icon: Camera,
      description: `${cameras.length - onlineCameras} офлайн`,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Обнаружено людей',
      value: '247',
      icon: Users,
      description: '+12% за последний час',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Критические события',
      value: criticalEvents.toString(),
      icon: AlertTriangle,
      description: `${warningEvents} предупреждений`,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
    },
    {
      title: 'Средняя загрузка',
      value: '73%',
      icon: Activity,
      description: 'Пиковые часы: 12:00-15:00',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  const recentActivity = [
    { time: '2 мин', text: 'Обнаружено движение — Камера входа', severity: 'warning' as const },
    { time: '15 мин', text: 'Очередь 5+ человек — Кассовая зона', severity: 'info' as const },
    { time: '30 мин', text: 'Подозрительное поведение — Торговый зал', severity: 'critical' as const },
    { time: '45 мин', text: 'Распознан номер A777AA 77 — Парковка', severity: 'info' as const },
    { time: '1 ч', text: 'Обнаружен VIP клиент — Главный вход', severity: 'info' as const },
    { time: '1.5 ч', text: 'Камера склада офлайн', severity: 'critical' as const },
  ];

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

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Camera Preview Grid */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Камеры</CardTitle>
                <CardDescription>Прямая трансляция с камер</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => router.push('/cameras')}>
                Все камеры
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {cameras.slice(0, 4).map((camera) => (
                  <div
                    key={camera.id}
                    className="relative rounded-lg border border-border bg-muted/30 overflow-hidden aspect-video group"
                  >
                    {/* Simulated camera feed */}
                    <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                      <Camera className="h-8 w-8 text-gray-600" />
                    </div>
                    {/* Camera overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-3">
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
                    {/* AI overlay indicators */}
                    {camera.status === 'online' && (
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        <div className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5">
                          <Eye className="h-3 w-3 text-green-400" />
                          <span className="text-[10px] text-green-400">AI</span>
                        </div>
                      </div>
                    )}
                    {camera.status === 'online' && (
                      <div className="absolute top-2 left-2">
                        <div className="flex items-center gap-1">
                          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] text-red-400 font-medium">REC</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
              <div className="space-y-3">
                {recentActivity.map((item, i) => (
                  <div key={i} className="flex gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                    <div
                      className={cn(
                        'mt-1 h-2 w-2 rounded-full shrink-0',
                        item.severity === 'critical'
                          ? 'bg-red-500'
                          : item.severity === 'warning'
                          ? 'bg-yellow-500'
                          : 'bg-blue-500'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{item.text}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{item.time} назад</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
                { label: 'Всего посетителей', value: '1,247' },
                { label: 'Среднее время визита', value: '24 мин' },
                { label: 'Пиковая загрузка', value: '85%' },
                { label: 'Инцидентов', value: '3' },
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
                { label: 'Использование CPU', value: '34%', color: 'text-green-500' },
                { label: 'Использование RAM', value: '67%', color: 'text-yellow-500' },
                { label: 'Хранилище', value: '2.4 TB / 5 TB', color: 'text-blue-500' },
                { label: 'Аптайм', value: '99.97%', color: 'text-green-500' },
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

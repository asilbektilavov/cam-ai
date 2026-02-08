'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, TrendingUp, TrendingDown, Minus, Loader2, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';

interface CurrentCountData {
  cameraId: string;
  cameraName: string;
  currentCount: number;
  totalReadings: number;
}

interface HourlyData {
  cameraId: string;
  cameraName: string;
  date: string;
  hourlyStats: { hour: number; avgCount: number; maxCount: number }[];
}

interface PeopleCounterWidgetProps {
  cameraId: string;
  cameraName: string;
  /** Maximum capacity for this camera's area (optional) */
  maxCapacity?: number;
  /** Auto-refresh interval in ms (default 10000) */
  refreshInterval?: number;
  className?: string;
}

export default function PeopleCounterWidget({
  cameraId,
  cameraName,
  maxCapacity,
  refreshInterval = 10000,
  className,
}: PeopleCounterWidgetProps) {
  const [currentData, setCurrentData] = useState<CurrentCountData | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyData | null>(null);
  const [prevCount, setPrevCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const [current, hourly] = await Promise.all([
        apiGet<CurrentCountData>(`/api/cameras/${cameraId}/people-count?mode=current`),
        apiGet<HourlyData>(`/api/cameras/${cameraId}/people-count?mode=hourly&date=${today}`),
      ]);

      setPrevCount(currentData?.currentCount ?? current.currentCount);
      setCurrentData(current);
      setHourlyData(hourly);
      setError(null);
    } catch (err) {
      console.error('[PeopleCounter] Failed to fetch:', err);
      setError('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [cameraId, currentData?.currentCount]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  // Trend: compare current count with previous reading
  const trend =
    currentData && currentData.currentCount > prevCount
      ? 'up'
      : currentData && currentData.currentCount < prevCount
        ? 'down'
        : 'stable';

  // Capacity percentage
  const capacityPercent =
    maxCapacity && currentData ? Math.round((currentData.currentCount / maxCapacity) * 100) : null;

  // Hourly chart data: only hours up to current hour
  const currentHour = new Date().getHours();
  const chartData = hourlyData?.hourlyStats.slice(0, currentHour + 1) ?? [];
  const maxHourlyCount = chartData.length > 0 ? Math.max(...chartData.map((h) => h.maxCount), 1) : 1;

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6 flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error || !currentData) {
    return (
      <Card className={className}>
        <CardContent className="p-6 flex items-center justify-center h-48 text-sm text-muted-foreground">
          {error || 'Нет данных'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-muted-foreground" />
            {cameraName}
          </div>
          <Badge
            variant="secondary"
            className={cn(
              'text-xs',
              trend === 'up' && 'text-green-600 dark:text-green-400',
              trend === 'down' && 'text-red-600 dark:text-red-400',
              trend === 'stable' && 'text-muted-foreground'
            )}
          >
            {trend === 'up' && <TrendingUp className="h-3 w-3 mr-1" />}
            {trend === 'down' && <TrendingDown className="h-3 w-3 mr-1" />}
            {trend === 'stable' && <Minus className="h-3 w-3 mr-1" />}
            {trend === 'up' ? 'Рост' : trend === 'down' ? 'Спад' : 'Стабильно'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current count - big number */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-5xl font-bold tabular-nums">{currentData.currentCount}</p>
            <p className="text-sm text-muted-foreground mt-1">человек сейчас</p>
          </div>

          {/* Capacity indicator */}
          {maxCapacity && capacityPercent !== null && (
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Вместимость</span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    capacityPercent >= 90
                      ? 'text-red-500'
                      : capacityPercent >= 70
                        ? 'text-yellow-500'
                        : 'text-green-500'
                  )}
                >
                  {capacityPercent}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    capacityPercent >= 90
                      ? 'bg-red-500'
                      : capacityPercent >= 70
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  )}
                  style={{ width: `${Math.min(capacityPercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1 text-right">
                макс. {maxCapacity}
              </p>
            </div>
          )}
        </div>

        {/* Hourly bar chart */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Активность по часам (сегодня)</span>
          </div>

          {chartData.length === 0 || chartData.every((h) => h.avgCount === 0) ? (
            <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
              Нет данных за сегодня
            </div>
          ) : (
            <div className="flex items-end gap-[2px] h-20">
              {chartData.map((item) => {
                const percentage = maxHourlyCount > 0 ? (item.avgCount / maxHourlyCount) * 100 : 0;
                const isCurrentHour = item.hour === currentHour;

                return (
                  <div
                    key={item.hour}
                    className="flex-1 flex flex-col items-center gap-0.5 group relative"
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground border rounded px-2 py-1 text-[10px] whitespace-nowrap z-10 shadow-md">
                      {item.hour}:00 — сред. {item.avgCount}, макс. {item.maxCount}
                    </div>

                    <div
                      className={cn(
                        'w-full rounded-t-sm transition-all min-h-[2px]',
                        isCurrentHour ? 'bg-blue-500' : 'bg-blue-400/60'
                      )}
                      style={{ height: `${Math.max(percentage, 3)}%` }}
                    />
                    {/* Show hour label for every 3rd hour */}
                    {item.hour % 3 === 0 && (
                      <span className="text-[8px] text-muted-foreground">{item.hour}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Всего замеров: {currentData.totalReadings}
          </span>
          {hourlyData && (
            <span className="text-xs text-muted-foreground">
              Макс. сегодня:{' '}
              {Math.max(...(hourlyData.hourlyStats.map((h) => h.maxCount) || [0]))}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

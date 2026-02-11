'use client';

import { useState, useEffect, useCallback } from 'react';
import { DoorOpen, ArrowDownToLine, ArrowUpFromLine, Loader2, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';

interface OccupancyCurrentData {
  cameraId: string;
  cameraName: string;
  currentOccupancy: number;
  totalIn: number;
  totalOut: number;
}

interface HourlyCrossing {
  hour: number;
  in: number;
  out: number;
}

interface OccupancyHourlyData {
  cameraId: string;
  cameraName: string;
  date: string;
  hourlyCrossings: HourlyCrossing[];
}

interface OccupancyWidgetProps {
  cameraId: string;
  cameraName: string;
  maxCapacity?: number;
  refreshInterval?: number;
  className?: string;
}

export default function OccupancyWidget({
  cameraId,
  cameraName,
  maxCapacity,
  refreshInterval = 10000,
  className,
}: OccupancyWidgetProps) {
  const [currentData, setCurrentData] = useState<OccupancyCurrentData | null>(null);
  const [hourlyData, setHourlyData] = useState<OccupancyHourlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const [current, hourly] = await Promise.all([
        apiGet<OccupancyCurrentData>(`/api/cameras/${cameraId}/occupancy?mode=current`),
        apiGet<OccupancyHourlyData>(`/api/cameras/${cameraId}/occupancy?mode=hourly&date=${today}`),
      ]);

      setCurrentData(current);
      setHourlyData(hourly);
      setError(null);
    } catch (err) {
      console.error('[OccupancyWidget] Failed to fetch:', err);
      setError('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  const capacityPercent =
    maxCapacity && currentData
      ? Math.round((currentData.currentOccupancy / maxCapacity) * 100)
      : null;

  const currentHour = new Date().getHours();
  const chartData = hourlyData?.hourlyCrossings.slice(0, currentHour + 1) ?? [];
  const maxHourlyVal = chartData.length > 0
    ? Math.max(...chartData.map((h) => h.in + h.out), 1)
    : 1;

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
        <CardTitle className="flex items-center gap-2 text-base">
          <DoorOpen className="h-5 w-5 text-muted-foreground" />
          {cameraName} — Заполняемость
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current occupancy */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-5xl font-bold tabular-nums">{currentData.currentOccupancy}</p>
            <p className="text-sm text-muted-foreground mt-1">человек внутри</p>
          </div>

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

        {/* In/Out stat cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <ArrowDownToLine className="h-4 w-4 text-green-500" />
            <div>
              <p className="text-lg font-semibold tabular-nums">{currentData.totalIn}</p>
              <p className="text-xs text-muted-foreground">Вошли</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-3">
            <ArrowUpFromLine className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-lg font-semibold tabular-nums">{currentData.totalOut}</p>
              <p className="text-xs text-muted-foreground">Вышли</p>
            </div>
          </div>
        </div>

        {/* Hourly stacked bar chart */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Проходы по часам (сегодня)</span>
            <div className="flex items-center gap-3 ml-auto">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-sm bg-green-500" /> Вход
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-sm bg-red-400" /> Выход
              </span>
            </div>
          </div>

          {chartData.length === 0 || chartData.every((h) => h.in === 0 && h.out === 0) ? (
            <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
              Нет данных за сегодня
            </div>
          ) : (
            <div className="flex items-end gap-[2px] h-20">
              {chartData.map((item) => {
                const inPct = (item.in / maxHourlyVal) * 100;
                const outPct = (item.out / maxHourlyVal) * 100;
                const isCurrentHour = item.hour === currentHour;

                return (
                  <div
                    key={item.hour}
                    className="flex-1 flex flex-col items-center gap-0.5 group relative"
                  >
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground border rounded px-2 py-1 text-[10px] whitespace-nowrap z-10 shadow-md">
                      {item.hour}:00 — вход: {item.in}, выход: {item.out}
                    </div>

                    <div className="w-full flex flex-col-reverse">
                      <div
                        className={cn(
                          'w-full rounded-b-sm transition-all min-h-[1px]',
                          isCurrentHour ? 'bg-green-500' : 'bg-green-500/60'
                        )}
                        style={{ height: `${Math.max(inPct, 2)}%` }}
                      />
                      <div
                        className={cn(
                          'w-full rounded-t-sm transition-all min-h-[1px]',
                          isCurrentHour ? 'bg-red-400' : 'bg-red-400/60'
                        )}
                        style={{ height: `${Math.max(outPct, 2)}%` }}
                      />
                    </div>

                    {item.hour % 3 === 0 && (
                      <span className="text-[8px] text-muted-foreground">{item.hour}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Всего проходов: {currentData.totalIn + currentData.totalOut}
          </span>
          {hourlyData && (
            <span className="text-xs text-muted-foreground">
              Пик входов:{' '}
              {Math.max(...hourlyData.hourlyCrossings.map((h) => h.in), 0)} / час
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

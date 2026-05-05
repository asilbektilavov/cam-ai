'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Users } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface VisitorCameraRow {
  cameraId: string;
  cameraName: string;
  location: string;
  count: number;
}

interface VisitorStats {
  total: number;
  todayCount: number;
  byDay: Array<{ day: string; count: number }>;
  byHour: Array<{ hour: number; count: number }>;
  byCamera: VisitorCameraRow[];
  byDayCamera: Record<string, VisitorCameraRow[]>;
}

function formatDayLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function VisitorStats() {
  const [data, setData] = useState<VisitorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  // null = aggregate view, otherwise the ISO day key (YYYY-MM-DD) the user
  // drilled into. Reset whenever the lookback window changes.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedDay(null);
    apiGet<VisitorStats>(`/api/visitors/stats?days=${days}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const periodTotal = data?.byDay.reduce((s, d) => s + d.count, 0) || 0;
  const maxDay = Math.max(1, ...(data?.byDay.map((d) => d.count) || [1]));
  const selectedDayData = selectedDay
    ? data?.byDay.find((d) => d.day === selectedDay)
    : null;
  const selectedCameras = selectedDay
    ? data?.byDayCamera?.[selectedDay] || []
    : null;
  const tableRows = selectedCameras ?? data?.byCamera ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Входы посетителей (без сотрудников)
          </span>
          <div className="flex gap-1">
            {[7, 14, 30].map((n) => (
              <button
                key={n}
                onClick={() => setDays(n)}
                className={cn(
                  'h-7 px-2 text-xs rounded-md transition-colors',
                  days === n
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted-foreground/15'
                )}
              >
                {n}д
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Пока нет данных. Здесь будут регистрироваться все входы посетителей
            на аттракционы (лица, не принадлежащие сотрудникам). Один человек,
            подходящий несколько раз — несколько счётов.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-md bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Сегодня</div>
                <div className="text-2xl font-bold">{data.todayCount}</div>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">За {days} дн</div>
                <div className="text-2xl font-bold">{periodTotal}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  ≈ {Math.round(periodTotal / days)} в день
                </div>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Камер активно</div>
                <div className="text-2xl font-bold">{data.byCamera.length}</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">
                По дням <span className="text-[10px]">(нажмите столбец чтобы посмотреть детали дня)</span>
              </div>
              <div className="flex items-end gap-1 h-20">
                {data.byDay.map((d) => {
                  const h = Math.max(2, (d.count / maxDay) * 80);
                  const isSelected = selectedDay === d.day;
                  return (
                    <button
                      key={d.day}
                      type="button"
                      onClick={() => setSelectedDay(isSelected ? null : d.day)}
                      className="flex-1 flex flex-col items-center gap-1 group focus:outline-none"
                    >
                      <div className="text-[10px] font-medium">{d.count || ''}</div>
                      <div
                        className={cn(
                          'w-full rounded-t transition-colors',
                          isSelected
                            ? 'bg-primary ring-2 ring-primary ring-offset-1 ring-offset-background'
                            : 'bg-primary/70 group-hover:bg-primary'
                        )}
                        style={{ height: `${h}px` }}
                        title={`${formatDay(d.day)}: ${d.count}`}
                      />
                      <div className={cn(
                        'text-[10px]',
                        isSelected ? 'text-primary font-semibold' : 'text-muted-foreground'
                      )}>
                        {formatDay(d.day)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDay && selectedDayData && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {formatDayLong(selectedDay)}
                  </div>
                  <div className="text-2xl font-bold">
                    {selectedDayData.count} <span className="text-sm font-normal text-muted-foreground">посетителей</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  показать всё
                </button>
              </div>
            )}

            {tableRows.length > 0 && (
              <div className="overflow-x-auto">
                <div className="text-xs text-muted-foreground mb-1">
                  {selectedDay ? 'По камерам за выбранный день' : `По камерам за ${days} дн`}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-2">Камера</th>
                      <th className="text-right pl-2 py-2">Посетителей</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((c) => (
                      <tr key={c.cameraId} className="border-b last:border-b-0">
                        <td className="py-2 pr-2">
                          <div className="font-medium">{c.cameraName}</div>
                          {c.location && (
                            <div className="text-[10px] text-muted-foreground">
                              {c.location}
                            </div>
                          )}
                        </td>
                        <td className="text-right pl-2 py-2 font-semibold tabular-nums">
                          {c.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}
      </CardContent>
    </Card>
  );
}

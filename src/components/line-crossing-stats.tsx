'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface CameraStats {
  cameraId: string;
  cameraName: string;
  location: string;
  total: number;
  byDay: Record<string, number>;
}

interface ApiResp {
  cameras: CameraStats[];
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function LineCrossingStats() {
  const [data, setData] = useState<CameraStats[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    setLoading(true);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    apiGet<ApiResp>(
      `/api/line-crossing/count?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`
    )
      .then((r) => setData(r.cameras))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [days]);

  // Build day list in Asia/Tashkent so the keys line up with the API's
  // tzFormatter buckets — toISOString() uses UTC and rolls over five hours
  // before local midnight, so the chart was looking at the wrong column
  // and counts looked like they were drifting between days.
  const tashkentFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = new Date();
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    dayList.push(tashkentFormatter.format(d));
  }

  const dayTotals = dayList.map((d) =>
    (data || []).reduce((sum, cam) => sum + (cam.byDay[d] || 0), 0)
  );
  const maxDayTotal = Math.max(1, ...dayTotals);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> Пересечения линий по камерам
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
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Нет данных за выбранный период. Нарисуйте линии (tripwire) на камерах
            и подсчёт начнётся автоматически.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Summary bar — total per day */}
            <div>
              <div className="text-xs text-muted-foreground mb-1">Всего по дням</div>
              <div className="flex items-end gap-1 h-20">
                {dayList.map((d, i) => {
                  const v = dayTotals[i];
                  const h = Math.max(2, (v / maxDayTotal) * 80);
                  return (
                    <div key={d} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[10px] font-medium">{v || ''}</div>
                      <div
                        className="w-full bg-primary/70 hover:bg-primary rounded-t"
                        style={{ height: `${h}px` }}
                        title={`${formatDay(d)}: ${v} пересечений`}
                      />
                      <div className="text-[10px] text-muted-foreground">
                        {formatDay(d)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-camera table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-2">Камера</th>
                    {dayList.map((d) => (
                      <th key={d} className="text-center px-1 py-2">
                        {formatDay(d)}
                      </th>
                    ))}
                    <th className="text-right pl-2 py-2">Всего</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((cam) => (
                    <tr key={cam.cameraId} className="border-b last:border-b-0">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{cam.cameraName}</div>
                        {cam.location && (
                          <div className="text-[10px] text-muted-foreground">{cam.location}</div>
                        )}
                      </td>
                      {dayList.map((d) => {
                        const v = cam.byDay[d] || 0;
                        return (
                          <td
                            key={d}
                            className={cn(
                              'text-center px-1 py-2 tabular-nums',
                              v === 0 && 'text-muted-foreground/40'
                            )}
                          >
                            {v}
                          </td>
                        );
                      })}
                      <td className="text-right pl-2 py-2 font-semibold tabular-nums">
                        {cam.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

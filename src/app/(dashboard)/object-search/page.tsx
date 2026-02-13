'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Loader2,
  Camera,
  Clock,
  ChevronDown,
  Filter,
  Package,
  Image,
  Users,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { apiGet } from '@/lib/api-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DetectionBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ObjectDetection {
  type: string;
  label: string;
  confidence: number;
  bbox?: DetectionBbox;
  color?: string;
}

interface ObjectResult {
  id: string;
  capturedAt: string;
  framePath: string;
  description: string | null;
  peopleCount: number | null;
  objects: string[];
  detections: ObjectDetection[];
  camera: { id: string; name: string; location: string };
  sessionId: string;
}

interface ObjectSearchResponse {
  results: ObjectResult[];
  total: number;
  availableTypes: string[];
}

interface UniqueVisitorsData {
  uniqueByFace: number;
  totalSightings: number;
  perDay: Array<{ day: string; unique: number }>;
  perCamera: Array<{ cameraId: string; cameraName: string; unique: number }>;
  approximate: {
    totalFramesWithPeople: number;
    totalPeopleDetections: number;
    peakPeopleCount: number;
  };
}

const OBJECT_LABELS: Record<string, string> = {
  person: 'Человек',
  car: 'Автомобиль',
  truck: 'Грузовик',
  bus: 'Автобус',
  bicycle: 'Велосипед',
  motorcycle: 'Мотоцикл',
  cat: 'Кошка',
  dog: 'Собака',
  backpack: 'Рюкзак',
  handbag: 'Сумка',
  suitcase: 'Чемодан',
  bottle: 'Бутылка',
  chair: 'Стул',
  laptop: 'Ноутбук',
  cell_phone: 'Телефон',
};

function formatDate(date: string) {
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FrameWithOverlay({ result, showBoxes }: { result: ObjectResult; showBoxes: boolean }) {
  const hasBboxes = result.detections.some((d) => d.bbox);

  return (
    <div className="relative aspect-video bg-muted overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/frames/${result.framePath}`}
        alt={result.description || 'Кадр'}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      {showBoxes && hasBboxes && (
        <div className="absolute inset-0">
          {result.detections
            .filter((d) => d.bbox)
            .map((det, i) => (
              <div
                key={i}
                className="absolute border-2 rounded-sm"
                style={{
                  left: `${(det.bbox!.x) * 100}%`,
                  top: `${(det.bbox!.y) * 100}%`,
                  width: `${(det.bbox!.w) * 100}%`,
                  height: `${(det.bbox!.h) * 100}%`,
                  borderColor: det.color || '#3B82F6',
                }}
              >
                <span
                  className="absolute -top-5 left-0 text-[10px] px-1 py-0.5 rounded-sm text-white whitespace-nowrap"
                  style={{ backgroundColor: det.color || '#3B82F6' }}
                >
                  {det.label} {Math.round(det.confidence * 100)}%
                </span>
              </div>
            ))}
        </div>
      )}
      {/* People count badge */}
      {result.peopleCount != null && result.peopleCount > 0 && (
        <div className="absolute top-2 right-2">
          <Badge className="bg-red-500/90 text-white border-0 text-xs">
            <Users className="h-3 w-3 mr-1" />
            {result.peopleCount} чел.
          </Badge>
        </div>
      )}
    </div>
  );
}

function ObjectSearchTab() {
  const [results, setResults] = useState<ObjectResult[]>([]);
  const [total, setTotal] = useState(0);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);

  const [objectType, setObjectType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);

  const search = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('triggerType', 'capacity_alert');
      if (objectType && objectType !== 'all') params.set('objectType', objectType);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const currentOffset = reset ? 0 : offset;
      params.set('limit', '50');
      params.set('offset', currentOffset.toString());

      const data = await apiGet<ObjectSearchResponse>(`/api/object-search?${params}`);
      if (reset) {
        setResults(data.results);
        setOffset(50);
      } else {
        setResults((prev) => [...prev, ...data.results]);
        setOffset((prev) => prev + 50);
      }
      setTotal(data.total);
      if (data.availableTypes.length > 0) {
        setAvailableTypes(data.availableTypes);
      }
    } catch {
      toast.error('Ошибка поиска');
    } finally {
      setLoading(false);
    }
  }, [objectType, dateFrom, dateTo, offset]);

  useEffect(() => {
    search(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Тип объекта</Label>
              <Select value={objectType} onValueChange={setObjectType}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Все объекты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {availableTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {OBJECT_LABELS[type] || type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">От</Label>
              <Input
                type="datetime-local"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[180px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">До</Label>
              <Input
                type="datetime-local"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[180px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && results.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Объекты не найдены</h3>
            <p className="text-muted-foreground text-sm">
              Попробуйте изменить параметры поиска
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Badge variant="secondary">Найдено: {total}</Badge>
            <div className="flex items-center gap-2">
              {showBoxes ? (
                <Eye className="h-4 w-4 text-muted-foreground" />
              ) : (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              )}
              <Label className="text-xs text-muted-foreground">Рамки</Label>
              <Switch checked={showBoxes} onCheckedChange={setShowBoxes} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => (
              <Card key={result.id} className="overflow-hidden">
                {result.framePath && (
                  <FrameWithOverlay result={result} showBoxes={showBoxes} />
                )}
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{result.camera.name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDate(result.capturedAt)}
                    </div>
                  </div>

                  {result.description && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {result.description}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1">
                    {result.detections.slice(0, 8).map((det, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {OBJECT_LABELS[det.label] || det.label}{' '}
                        <span className="text-muted-foreground ml-1">
                          {Math.round(det.confidence * 100)}%
                        </span>
                      </Badge>
                    ))}
                    {result.detections.length > 8 && (
                      <Badge variant="outline" className="text-xs">
                        +{result.detections.length - 8}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {results.length < total && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => search(false)}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ChevronDown className="h-4 w-4 mr-2" />
                )}
                Загрузить ещё ({results.length} из {total})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UniqueVisitorsTab() {
  const [data, setData] = useState<UniqueVisitorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('7');

  useEffect(() => {
    setLoading(true);
    const from = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    apiGet<UniqueVisitorsData>(`/api/unique-visitors?from=${from}`)
      .then(setData)
      .catch(() => toast.error('Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <Label className="text-sm">Период:</Label>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Последний день</SelectItem>
            <SelectItem value="7">Последние 7 дней</SelectItem>
            <SelectItem value="14">Последние 14 дней</SelectItem>
            <SelectItem value="30">Последние 30 дней</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-500">{data.uniqueByFace}</p>
              <p className="text-sm text-muted-foreground">Уникальных (по лицу)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{data.totalSightings}</p>
              <p className="text-sm text-muted-foreground">Всего обнаружений</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-500">{data.approximate.totalPeopleDetections}</p>
              <p className="text-sm text-muted-foreground">Детекций людей (YOLO)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-orange-500">{data.approximate.peakPeopleCount}</p>
              <p className="text-sm text-muted-foreground">Пик одновременно</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per day */}
      {data.perDay.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Уникальные посетители по дням</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.perDay.map((d) => (
                <div key={d.day} className="flex items-center justify-between rounded border p-2">
                  <span className="text-sm">{new Date(d.day).toLocaleDateString('ru-RU')}</span>
                  <Badge variant="secondary">{d.unique} уник.</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per camera */}
      {data.perCamera.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">По камерам</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.perCamera.map((c) => (
                <div key={c.cameraId} className="flex items-center justify-between rounded border p-2">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{c.cameraName}</span>
                  </div>
                  <Badge variant="secondary">{c.unique} уник.</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ObjectSearchPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Поиск объектов</h1>
        <p className="text-muted-foreground">
          Поиск объектов в архиве и подсчёт уникальных посетителей
        </p>
      </div>

      <Tabs defaultValue="objects">
        <TabsList>
          <TabsTrigger value="objects" className="gap-1.5">
            <Search className="h-4 w-4" />
            Поиск объектов
          </TabsTrigger>
          <TabsTrigger value="visitors" className="gap-1.5">
            <Users className="h-4 w-4" />
            Уникальные посетители
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objects" className="mt-4">
          <ObjectSearchTab />
        </TabsContent>

        <TabsContent value="visitors" className="mt-4">
          <UniqueVisitorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Loader2,
  Search,
  ArrowRight,
  Camera,
  Percent,
  RefreshCw,
  UserCheck,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';

interface CameraOption {
  id: string;
  name: string;
  location: string;
}

interface MatchResult {
  id: string;
  personIdA: string;
  personIdB: string;
  thumbnailA: string | null;
  thumbnailB: string | null;
  similarity: number;
  cameraAName: string;
  cameraBName: string;
  detectedAtA: string;
  detectedAtB: string;
}

interface TrackingData {
  matches: MatchResult[];
  totalMatches: number;
  avgSimilarity: number;
  lastUpdated: string | null;
}

export default function CrossTrackingPage() {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [cameraA, setCameraA] = useState('');
  const [cameraB, setCameraB] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState<TrackingData | null>(null);
  const { selectedBranchId } = useAppStore();

  const fetchCameras = useCallback(async () => {
    try {
      const branchParam = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const result = await apiGet<CameraOption[]>(`/api/cameras${branchParam}`);
      setCameras(result);
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const fetchTrackingData = useCallback(async () => {
    if (!cameraA || !cameraB) return;
    try {
      const result = await apiGet<TrackingData>(
        `/api/cross-tracking?cameraA=${cameraA}&cameraB=${cameraB}`
      );
      setData(result);
    } catch (err) {
      console.error('Failed to fetch tracking data:', err);
    }
  }, [cameraA, cameraB]);

  useEffect(() => {
    if (cameraA && cameraB) {
      fetchTrackingData();
    }
  }, [cameraA, cameraB, fetchTrackingData]);

  const handleSearch = async () => {
    if (!cameraA || !cameraB) {
      toast.error('Выберите обе камеры');
      return;
    }
    if (cameraA === cameraB) {
      toast.error('Выберите разные камеры');
      return;
    }
    setSearching(true);
    try {
      const result = await apiPost<TrackingData>('/api/cross-tracking', {
        cameraAId: cameraA,
        cameraBId: cameraB,
      });
      setData(result);
      toast.success(`Найдено совпадений: ${result.totalMatches}`);
    } catch {
      toast.error('Не удалось выполнить поиск');
    } finally {
      setSearching(false);
    }
  };

  const getSimilarityColor = (score: number) => {
    if (score >= 0.9) return 'text-green-500';
    if (score >= 0.75) return 'text-yellow-500';
    return 'text-orange-500';
  };

  const getSimilarityBadge = (score: number) => {
    if (score >= 0.9) return { label: 'Высокое', variant: 'default' as const };
    if (score >= 0.75) return { label: 'Среднее', variant: 'secondary' as const };
    return { label: 'Низкое', variant: 'outline' as const };
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Кросс-камерное отслеживание</h1>
        <p className="text-muted-foreground">
          Отслеживание одних и тех же людей между различными камерами
        </p>
      </div>

      {/* Camera Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Выбор камер
          </CardTitle>
          <CardDescription>
            Выберите две камеры для поиска совпадений между ними
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 w-full">
              <label className="text-sm font-medium mb-2 block">Камера A</label>
              <Select value={cameraA} onValueChange={setCameraA}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите камеру A" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((cam) => (
                    <SelectItem key={cam.id} value={cam.id}>
                      {cam.name} — {cam.location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-center pt-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>

            <div className="flex-1 w-full">
              <label className="text-sm font-medium mb-2 block">Камера B</label>
              <Select value={cameraB} onValueChange={setCameraB}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите камеру B" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((cam) => (
                    <SelectItem key={cam.id} value={cam.id}>
                      {cam.name} — {cam.location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="pt-6">
              <Button
                onClick={handleSearch}
                disabled={searching || !cameraA || !cameraB}
                className="gap-2"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Найти совпадения
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <UserCheck className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.totalMatches}</p>
                <p className="text-sm text-muted-foreground">Совпадений</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <Percent className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {data.avgSimilarity > 0 ? `${Math.round(data.avgSimilarity * 100)}%` : '—'}
                </p>
                <p className="text-sm text-muted-foreground">Средняя схожесть</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                <Clock className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {data.lastUpdated
                    ? new Date(data.lastUpdated).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
                <p className="text-sm text-muted-foreground">Последнее обновление</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {data && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Результаты сопоставления
                </CardTitle>
                <CardDescription>
                  {data.totalMatches > 0
                    ? `Найдено ${data.totalMatches} совпадений между камерами`
                    : 'Совпадения не найдены'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleSearch} disabled={searching}>
                <RefreshCw className={cn('h-4 w-4 mr-2', searching && 'animate-spin')} />
                Обновить
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {data.matches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Совпадения не найдены</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Попробуйте выбрать другие камеры или подождите накопления данных
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <div className="col-span-4">Камера A</div>
                  <div className="col-span-1 text-center">Схожесть</div>
                  <div className="col-span-4">Камера B</div>
                  <div className="col-span-3 text-right">Время</div>
                </div>

                {data.matches.map((match) => {
                  const badge = getSimilarityBadge(match.similarity);
                  return (
                    <div
                      key={match.id}
                      className="grid grid-cols-12 gap-4 items-center px-4 py-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      {/* Camera A Person */}
                      <div className="col-span-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 shrink-0">
                          {match.thumbnailA ? (
                            <img
                              src={match.thumbnailA}
                              alt="Person A"
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <Users className="h-5 w-5 text-blue-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{match.cameraAName}</p>
                          <p className="text-xs text-muted-foreground">
                            ID: {match.personIdA.slice(0, 8)}...
                          </p>
                        </div>
                      </div>

                      {/* Similarity */}
                      <div className="col-span-1 flex flex-col items-center gap-1">
                        <span className={cn('text-lg font-bold', getSimilarityColor(match.similarity))}>
                          {Math.round(match.similarity * 100)}%
                        </span>
                        <Badge variant={badge.variant} className="text-[10px]">
                          {badge.label}
                        </Badge>
                      </div>

                      {/* Camera B Person */}
                      <div className="col-span-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/10 shrink-0">
                          {match.thumbnailB ? (
                            <img
                              src={match.thumbnailB}
                              alt="Person B"
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <Users className="h-5 w-5 text-purple-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{match.cameraBName}</p>
                          <p className="text-xs text-muted-foreground">
                            ID: {match.personIdB.slice(0, 8)}...
                          </p>
                        </div>
                      </div>

                      {/* Time */}
                      <div className="col-span-3 text-right">
                        <p className="text-xs text-muted-foreground">
                          A: {formatTime(match.detectedAtA)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          B: {formatTime(match.detectedAtB)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state when no cameras selected */}
      {!data && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Выберите камеры для анализа</h3>
            <p className="text-muted-foreground max-w-md">
              Выберите две камеры выше и нажмите «Найти совпадения» для поиска
              одних и тех же людей на разных камерах
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Clock,
  CalendarDays,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';
import { VideoPlayer } from '@/components/video-player';
import { DetectionOverlay, Detection } from '@/components/detection-overlay';

interface TimelineHour {
  available: boolean;
  segments: number;
  duration: number;
  size: number;
}

interface TimelineResponse {
  hours: Record<string, TimelineHour>;
  totalSegments: number;
  totalDuration: number;
}

interface ArchiveDetectionFrame {
  capturedAt: string;
  detections: Detection[];
}

interface ArchivePlayerProps {
  cameraId: string;
  cameraName: string;
}

export function ArchivePlayer({ cameraId, cameraName }: ArchivePlayerProps) {
  const today = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<Record<string, TimelineHour>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [showDetections, setShowDetections] = useState(true);
  const [archiveDetections, setArchiveDetections] = useState<ArchiveDetectionFrame[]>([]);
  const [currentDetections, setCurrentDetections] = useState<Detection[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const fetchTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    try {
      const data = await apiGet<TimelineResponse>(
        `/api/cameras/${cameraId}/timeline?date=${selectedDate}`
      );
      setTimeline(data.hours || {});
    } catch {
      setTimeline({});
    } finally {
      setLoadingTimeline(false);
    }
  }, [cameraId, selectedDate]);

  useEffect(() => {
    fetchTimeline();
    setSelectedHour(null);
    setIsPlaying(false);
  }, [fetchTimeline]);

  // Fetch archive detections when hour changes
  useEffect(() => {
    if (selectedHour === null) {
      setArchiveDetections([]);
      setCurrentDetections([]);
      return;
    }

    const from = `${selectedDate}T${String(selectedHour).padStart(2, '0')}:00:00.000Z`;
    const to = `${selectedDate}T${String(selectedHour).padStart(2, '0')}:59:59.999Z`;

    apiGet<ArchiveDetectionFrame[]>(
      `/api/cameras/${cameraId}/detections?from=${from}&to=${to}`
    )
      .then((data) => setArchiveDetections(data))
      .catch(() => setArchiveDetections([]));
  }, [cameraId, selectedDate, selectedHour]);

  // Sync detections with video currentTime via RAF
  useEffect(() => {
    if (!isPlaying || archiveDetections.length === 0 || !showDetections) {
      setCurrentDetections([]);
      return;
    }

    const container = videoContainerRef.current;
    if (!container) return;

    let rafId: number;
    const syncDetections = () => {
      const video = container.querySelector('video');
      if (video && video.currentTime > 0) {
        // Map video currentTime to actual time
        const hourStart = new Date(`${selectedDate}T${String(selectedHour).padStart(2, '0')}:00:00.000Z`).getTime();
        const currentTimeMs = hourStart + video.currentTime * 1000;

        // Find closest frame (within 5 seconds)
        let closest: ArchiveDetectionFrame | null = null;
        let closestDiff = Infinity;

        for (const frame of archiveDetections) {
          const frameTime = new Date(frame.capturedAt).getTime();
          const diff = Math.abs(frameTime - currentTimeMs);
          if (diff < closestDiff && diff < 5000) {
            closest = frame;
            closestDiff = diff;
          }
        }

        setCurrentDetections(closest?.detections || []);
      }
      rafId = requestAnimationFrame(syncDetections);
    };

    rafId = requestAnimationFrame(syncDetections);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, archiveDetections, showDetections, selectedDate, selectedHour]);

  const archiveUrl =
    selectedHour !== null
      ? `/api/cameras/${cameraId}/archive?date=${selectedDate}&hour=${selectedHour}`
      : null;

  const handleHourClick = (hour: number) => {
    const hourData = timeline[String(hour)];
    if (!hourData?.available) return;
    setSelectedHour(hour);
    setIsPlaying(true);
  };

  const handlePreviousHour = () => {
    if (selectedHour === null || selectedHour <= 0) return;
    for (let h = selectedHour - 1; h >= 0; h--) {
      if (timeline[String(h)]?.available) {
        setSelectedHour(h);
        setIsPlaying(true);
        return;
      }
    }
  };

  const handleNextHour = () => {
    if (selectedHour === null || selectedHour >= 23) return;
    for (let h = selectedHour + 1; h <= 23; h++) {
      if (timeline[String(h)]?.available) {
        setSelectedHour(h);
        setIsPlaying(true);
        return;
      }
    }
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  const formatHour = (hour: number) => {
    return `${String(hour).padStart(2, '0')}:00`;
  };

  const availableHours = Object.entries(timeline)
    .filter(([, v]) => v.available)
    .map(([k]) => parseInt(k));

  const hasPrevious =
    selectedHour !== null && availableHours.some((h) => h < selectedHour);
  const hasNext =
    selectedHour !== null && availableHours.some((h) => h > selectedHour);

  return (
    <div className="space-y-4">
      {/* Header with date picker and camera name */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">{cameraName}</h3>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
          />
        </div>
      </div>

      {/* Video Player Area */}
      <div ref={containerRef} className="relative">
        {archiveUrl && isPlaying ? (
          <div ref={videoContainerRef} className="relative aspect-video w-full">
            <VideoPlayer
              src={archiveUrl}
              live={false}
              controls={true}
              autoPlay={true}
              muted={false}
              playbackRate={parseFloat(speed)}
              className="aspect-video w-full"
              onError={() => setIsPlaying(false)}
            />
            <DetectionOverlay
              detections={currentDetections}
              visible={showDetections}
            />
            {/* Detection toggle */}
            <button
              onClick={() => setShowDetections((v) => !v)}
              className={cn(
                'absolute top-3 right-3 z-20 flex items-center justify-center h-7 w-7 rounded-full transition-colors',
                showDetections
                  ? 'bg-blue-500/80 text-white hover:bg-blue-500'
                  : 'bg-black/50 text-gray-300 hover:bg-black/70'
              )}
            >
              {showDetections ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : (
          <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center gap-3">
            <Clock className="h-12 w-12 text-gray-600" />
            <p className="text-sm text-gray-400">
              {selectedHour !== null
                ? 'Загрузка записи...'
                : 'Выберите час на таймлайне для воспроизведения'}
            </p>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePreviousHour}
                disabled={!hasPrevious}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextHour}
                disabled={!hasNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {selectedHour !== null && (
                <Badge variant="secondary" className="text-sm px-3">
                  {formatHour(selectedHour)} &mdash; {formatHour(selectedHour + 1)}
                </Badge>
              )}
            </div>

            {/* Speed and fullscreen */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Скорость:</span>
              <Select value={speed} onValueChange={setSpeed}>
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                  <SelectItem value="4">4x</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={handleFullscreen}>
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 24-hour timeline bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Таймлайн</span>
            <span className="text-xs text-muted-foreground">
              {selectedDate} &middot; {availableHours.length} ч. записей
            </span>
          </div>
          {loadingTimeline ? (
            <div className="h-10 flex items-center justify-center">
              <span className="text-sm text-muted-foreground">Загрузка...</span>
            </div>
          ) : (
            <div className="relative">
              {/* Hour labels */}
              <div className="flex">
                {Array.from({ length: 24 }, (_, i) => (
                  <div
                    key={`label-${i}`}
                    className="flex-1 text-center text-[10px] text-muted-foreground"
                  >
                    {i % 3 === 0 ? String(i).padStart(2, '0') : ''}
                  </div>
                ))}
              </div>

              {/* Timeline segments */}
              <div className="flex h-8 gap-0.5 mt-1">
                {Array.from({ length: 24 }, (_, hour) => {
                  const hourData = timeline[String(hour)];
                  const hasRecording = hourData?.available ?? false;
                  const isSelected = selectedHour === hour;

                  return (
                    <button
                      key={hour}
                      onClick={() => handleHourClick(hour)}
                      disabled={!hasRecording}
                      title={
                        hasRecording
                          ? `${formatHour(hour)} — ${hourData.segments} сегм., ${Math.round(hourData.duration / 60)} мин.`
                          : `${formatHour(hour)} — нет записей`
                      }
                      className={cn(
                        'flex-1 rounded-sm transition-all relative',
                        hasRecording
                          ? 'bg-green-500/70 hover:bg-green-500 cursor-pointer'
                          : 'bg-muted cursor-not-allowed',
                        isSelected && 'ring-2 ring-blue-500 bg-green-500'
                      )}
                    >
                      {/* Current playback position indicator */}
                      {isSelected && (
                        <div className="absolute inset-x-0 top-0 bottom-0 flex items-center justify-center">
                          <div className="w-0.5 h-full bg-blue-500 animate-pulse" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-green-500/70" />
                  <span className="text-[10px] text-muted-foreground">Есть запись</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-muted" />
                  <span className="text-[10px] text-muted-foreground">Нет записи</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm ring-2 ring-blue-500 bg-green-500" />
                  <span className="text-[10px] text-muted-foreground">Воспроизведение</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

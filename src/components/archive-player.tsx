'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarDays, Loader2, Play, Pause, Maximize, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api-client';

interface SegmentInfo {
  name: string;
  size: number;
  duration: number;
  url: string;
}

interface ArchiveResponse {
  hours: Array<{
    hour: string;
    segments: SegmentInfo[];
  }>;
}

interface ArchivePlayerProps {
  cameraId: string;
  cameraName: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(filename: string): string {
  // Recorder filename: 2026-04-26_14-26-16.ts → 14:26:16
  const m = filename.match(/_(\d{2})-(\d{2})-(\d{2})\.ts$/);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : filename;
}

export function ArchivePlayer({ cameraId, cameraName }: ArchivePlayerProps) {
  const today = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [hours, setHours] = useState<ArchiveResponse['hours']>([]);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SegmentInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Fetch dates with recordings
  useEffect(() => {
    let cancelled = false;
    apiGet<{ dates: string[] }>(`/api/cameras/${cameraId}/dates`)
      .then((data) => {
        if (cancelled) return;
        setAvailableDates(data.dates || []);
        if (data.dates?.length && !data.dates.includes(selectedDate)) {
          setSelectedDate(data.dates[0]);
        }
      })
      .catch(() => { if (!cancelled) setAvailableDates([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  // Fetch full file list for selected date (all hours)
  useEffect(() => {
    let cancelled = false;
    setLoadingArchive(true);
    setSelectedFile(null);
    apiGet<ArchiveResponse>(`/api/cameras/${cameraId}/archive?date=${selectedDate}`)
      .then((data) => {
        if (cancelled) return;
        setHours(data.hours || []);
        // Auto-select latest file
        const allSegs = (data.hours || []).flatMap((h) => h.segments);
        if (allSegs.length > 0) {
          setSelectedFile(allSegs[allSegs.length - 1]);
        }
      })
      .catch(() => { if (!cancelled) setHours([]); })
      .finally(() => { if (!cancelled) setLoadingArchive(false); });
    return () => { cancelled = true; };
  }, [cameraId, selectedDate]);

  // Manage video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedFile) return;
    video.src = selectedFile.url;
    video.load();
    video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [selectedFile]);

  const handleTogglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play(); setIsPlaying(true); }
    else { video.pause(); setIsPlaying(false); }
  };

  const handleFullscreen = () => {
    videoRef.current?.requestFullscreen?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">{cameraName}</h3>
      </div>

      {/* Date pills */}
      {availableDates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center">Дни с записями:</span>
          {availableDates.map((d) => {
            const isSel = d === selectedDate;
            const date = new Date(d);
            const label = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={cn(
                  'h-7 px-3 rounded-md text-xs font-medium transition-colors',
                  isSel ? 'bg-primary text-primary-foreground'
                        : 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Video */}
      <div className="aspect-video w-full rounded-lg bg-black overflow-hidden relative">
        {selectedFile ? (
          <video
            ref={videoRef}
            controls
            muted={muted}
            className="w-full h-full"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            {loadingArchive ? 'Загрузка...' : 'Нет записей за выбранную дату'}
          </div>
        )}
      </div>

      {/* Controls */}
      {selectedFile && (
        <div className="flex items-center gap-2 px-1">
          <Button variant="outline" size="icon" onClick={handleTogglePlay}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={handleFullscreen} className="ml-auto">
            <Maximize className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
            {formatTime(selectedFile.name)} · {formatBytes(selectedFile.size)} · {formatDuration(selectedFile.duration)}
          </span>
        </div>
      )}

      {/* File list grouped by hour */}
      {loadingArchive ? (
        <Card><CardContent className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent></Card>
      ) : hours.length === 0 ? (
        <Card><CardContent className="text-sm text-muted-foreground text-center py-6">
          Нет записей за {selectedDate}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {hours.map((h) => (
            <Card key={h.hour}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{h.hour}:00 — {h.hour}:59</span>
                  <span className="text-xs text-muted-foreground">{h.segments.length} записей</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {h.segments.map((seg) => {
                    const isSel = selectedFile?.url === seg.url;
                    return (
                      <button
                        key={seg.name}
                        type="button"
                        onClick={() => setSelectedFile(seg)}
                        className={cn(
                          'flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-md text-xs transition-colors',
                          isSel ? 'bg-primary text-primary-foreground'
                                : 'bg-muted hover:bg-muted-foreground/15'
                        )}
                      >
                        <span className="font-mono font-medium">{formatTime(seg.name)}</span>
                        <span className="text-[10px] opacity-70">
                          {formatDuration(seg.duration)} · {formatBytes(seg.size)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

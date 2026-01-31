'use client';

import { Camera, Clock, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Sighting {
  id: string;
  timestamp: string;
  confidence: number;
  description: string | null;
  camera: {
    id: string;
    name: string;
    location: string;
  };
}

interface SightingTimelineProps {
  sightings: Sighting[];
}

export function SightingTimeline({ sightings }: SightingTimelineProps) {
  if (sightings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Пока нет обнаружений
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sightings.map((s) => {
        const date = new Date(s.timestamp);
        const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

        return (
          <div key={s.id} className="flex gap-3 items-start">
            <div className="flex flex-col items-center">
              <div className="h-2 w-2 rounded-full bg-red-500 mt-1.5" />
              <div className="w-px h-full bg-border" />
            </div>
            <div className="flex-1 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-sm font-medium">
                  <Camera className="h-3.5 w-3.5" />
                  {s.camera.name}
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {Math.round(s.confidence * 100)}%
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {s.camera.location}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {dateStr}, {timeStr}
                </span>
              </div>
              {s.description && (
                <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

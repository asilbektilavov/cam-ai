'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface LoiteringConfigProps {
  config: { maxLoiterSeconds?: number };
  onChange: (config: { maxLoiterSeconds: number }) => void;
}

export function LoiteringConfig({ config, onChange }: LoiteringConfigProps) {
  const minutes = Math.round((config.maxLoiterSeconds ?? 300) / 60);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Макс. время нахождения на одном месте (мин.)</Label>
        <Input
          type="number"
          min={1}
          max={60}
          value={minutes}
          onChange={(e) => {
            const mins = Math.max(1, parseInt(e.target.value) || 5);
            onChange({ maxLoiterSeconds: mins * 60 });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Если человек находится на одном месте дольше указанного времени — отправится уведомление
        </p>
      </div>
    </div>
  );
}

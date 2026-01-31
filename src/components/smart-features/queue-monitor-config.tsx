'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface QueueMonitorConfigProps {
  config: { maxQueueLength?: number };
  onChange: (config: { maxQueueLength: number }) => void;
}

export function QueueMonitorConfig({ config, onChange }: QueueMonitorConfigProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Максимальная длина очереди</Label>
        <Input
          type="number"
          min={1}
          max={100}
          value={config.maxQueueLength ?? 5}
          onChange={(e) =>
            onChange({ maxQueueLength: Math.max(1, parseInt(e.target.value) || 5) })
          }
        />
        <p className="text-xs text-muted-foreground">
          Если количество людей в очереди превысит это число — отправится уведомление
        </p>
      </div>
    </div>
  );
}

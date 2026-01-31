'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface WorkstationConfigProps {
  config: { minPeople?: number; maxAbsenceSeconds?: number };
  onChange: (config: { minPeople: number; maxAbsenceSeconds: number }) => void;
}

export function WorkstationConfig({ config, onChange }: WorkstationConfigProps) {
  const minPeople = config.minPeople ?? 1;
  const absenceMinutes = Math.round((config.maxAbsenceSeconds ?? 120) / 60);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Минимальное кол-во сотрудников</Label>
        <Input
          type="number"
          min={1}
          max={20}
          value={minPeople}
          onChange={(e) =>
            onChange({
              minPeople: Math.max(1, parseInt(e.target.value) || 1),
              maxAbsenceSeconds: config.maxAbsenceSeconds ?? 120,
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Макс. время отсутствия (мин.)</Label>
        <Input
          type="number"
          min={1}
          max={60}
          value={absenceMinutes}
          onChange={(e) => {
            const mins = Math.max(1, parseInt(e.target.value) || 2);
            onChange({
              minPeople: config.minPeople ?? 1,
              maxAbsenceSeconds: mins * 60,
            });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Если на рабочем месте нет сотрудников дольше указанного времени — отправится уведомление
        </p>
      </div>
    </div>
  );
}

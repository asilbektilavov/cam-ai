'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet } from '@/lib/api-client';

interface Integration {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
}

interface IntegrationSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

export function IntegrationSelector({ value, onChange }: IntegrationSelectorProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  useEffect(() => {
    apiGet<Integration[]>('/api/integrations')
      .then((data) => setIntegrations(data.filter((i) => i.enabled)))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-2">
      <Label>Куда отправлять уведомления</Label>
      <Select
        value={value || '_none'}
        onValueChange={(v) => onChange(v === '_none' ? null : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Не выбрано" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">Не отправлять</SelectItem>
          {integrations.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {integrations.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Нет подключённых интеграций. Настройте в разделе «Интеграции».
        </p>
      )}
    </div>
  );
}

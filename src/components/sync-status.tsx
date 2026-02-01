'use client';

import { useState, useEffect } from 'react';
import { Link2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { apiGet } from '@/lib/api-client';

interface SyncStatusData {
  role: 'central' | 'satellite' | 'standalone';
  instances?: { id: string }[];
  lastSyncAt?: string | null;
  error?: boolean;
}

function formatMinutesAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusData | null>(null);

  useEffect(() => {
    const fetchStatus = () => {
      apiGet<SyncStatusData>('/api/sync/status')
        .then((data) => setStatus(data))
        .catch(() => setStatus(null));
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!status || status.role === 'standalone') {
    return null;
  }

  if (status.role === 'central') {
    const count = status.instances?.length ?? 0;
    return (
      <Badge variant="secondary" className="gap-1 text-xs font-normal">
        <Link2 className="h-3 w-3" />
        {count} {count === 1 ? 'филиал' : count >= 2 && count <= 4 ? 'филиала' : 'филиалов'}
      </Badge>
    );
  }

  if (status.role === 'satellite') {
    if (status.error) {
      return (
        <Badge variant="destructive" className="gap-1 text-xs font-normal">
          <AlertTriangle className="h-3 w-3" />
          Ошибка синхр.
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="gap-1 text-xs font-normal">
        <Link2 className="h-3 w-3" />
        Синхр. {status.lastSyncAt ? formatMinutesAgo(status.lastSyncAt) : 'ожидание'}
      </Badge>
    );
  }

  return null;
}

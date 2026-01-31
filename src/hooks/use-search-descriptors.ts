'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api-client';

export interface SearchDescriptor {
  id: string;
  name: string;
  descriptor: number[];
  integrationId: string | null;
}

const REFRESH_INTERVAL_MS = 30000; // 30 seconds

export function useSearchDescriptors() {
  const [descriptors, setDescriptors] = useState<SearchDescriptor[]>([]);

  const fetch = useCallback(async () => {
    try {
      const data = await apiGet<SearchDescriptor[]>('/api/person-search/descriptors');
      setDescriptors(data);
    } catch {
      // Silent fail — descriptors just won't update
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetch]);

  return { descriptors, refresh: fetch };
}

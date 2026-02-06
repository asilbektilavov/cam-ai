'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  createdAt: string;
  _count: { cameras: number };
}

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { selectedBranchId, setSelectedBranchId } = useAppStore();

  const fetchBranches = useCallback(async () => {
    try {
      const data = await apiGet<Branch[]>('/api/branches');
      const list = Array.isArray(data) ? data : [];
      setBranches(list);

      // Auto-select first branch if none selected or current not in list
      if (list.length > 0) {
        const ids = list.map((b) => b.id);
        if (!selectedBranchId || !ids.includes(selectedBranchId)) {
          setSelectedBranchId(list[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load branches:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranchId, setSelectedBranchId]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  return { branches, isLoading, refetch: fetchBranches };
}

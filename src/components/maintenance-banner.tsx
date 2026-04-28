'use client';

import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';

interface State {
  active: boolean;
  message: string;
}

export function MaintenanceBanner() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/maintenance', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as State;
        if (!cancelled) setState(data);
      } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!state?.active) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-300 px-4 py-2 flex items-center gap-3 text-sm">
      <Wrench className="h-4 w-4 shrink-0 animate-pulse" />
      <span className="flex-1">{state.message}</span>
    </div>
  );
}

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
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] max-w-2xl w-[calc(100%-2rem)] pointer-events-none">
      <div className="pointer-events-auto bg-amber-500 text-black border-2 border-amber-300 shadow-2xl shadow-amber-500/40 rounded-xl px-5 py-3 flex items-center gap-3 text-base font-semibold animate-pulse">
        <Wrench className="h-6 w-6 shrink-0" />
        <span className="flex-1 leading-tight">{state.message}</span>
      </div>
    </div>
  );
}

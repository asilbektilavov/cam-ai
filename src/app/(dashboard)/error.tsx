'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-8">
      <div className="max-w-lg w-full rounded-lg border border-red-500/20 bg-red-500/5 p-6">
        <h2 className="text-lg font-semibold text-red-500 mb-2">
          Dashboard Error
        </h2>
        <pre className="text-sm text-muted-foreground whitespace-pre-wrap break-all mb-4 bg-muted/50 rounded p-3 max-h-60 overflow-auto">
          {error.message}
          {error.stack && '\n\n' + error.stack}
        </pre>
        {error.digest && (
          <p className="text-xs text-muted-foreground mb-4">
            Digest: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}

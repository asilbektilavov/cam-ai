'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <h1 style={{ color: '#ef4444' }}>Global Error</h1>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#111', color: '#eee', padding: '1rem', borderRadius: '8px', maxHeight: '400px', overflow: 'auto' }}>
          {error.message}
          {error.stack && '\n\n' + error.stack}
        </pre>
        {error.digest && <p>Digest: {error.digest}</p>}
        <button onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Retry
        </button>
      </body>
    </html>
  );
}

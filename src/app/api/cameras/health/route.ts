import { NextResponse } from 'next/server';

// Returns the in-memory healthcheck cache populated by instrumentation.ts.
// No DB hit; cheap enough to poll every 10s from every dashboard page.
const HEALTH_CACHE_KEY = '__cameraHealthCache';

export async function GET() {
  const cache = (process as unknown as {
    [HEALTH_CACHE_KEY]?: Map<string, { latencyMs: number | null; alive: boolean; checkedAt: number }>;
  })[HEALTH_CACHE_KEY];

  if (!cache) return NextResponse.json({});

  const out: Record<string, { latencyMs: number | null; alive: boolean; checkedAt: number }> = {};
  for (const [id, entry] of cache) out[id] = entry;
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}

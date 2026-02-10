import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';
import { audioAnalyzer } from '@/lib/services/audio-analyzer';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'view_analytics');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const cameraId = searchParams.get('cameraId');

  if (!cameraId) {
    return NextResponse.json(
      { error: 'Query param "cameraId" is required' },
      { status: 400 }
    );
  }

  const results = audioAnalyzer.getRecentEvents(cameraId);
  const events = audioAnalyzer.getRecentEventsList(cameraId);

  const criticalCount = events.filter(
    (e) => e.type === 'gunshot' || e.type === 'scream'
  ).length;
  const warningCount = events.filter(
    (e) => e.type === 'glass_break' || e.type === 'alarm'
  ).length;
  const infoCount = events.filter(
    (e) => e.type !== 'gunshot' && e.type !== 'scream' && e.type !== 'glass_break' && e.type !== 'alarm'
  ).length;

  const latestResult = results.length > 0 ? results[results.length - 1] : null;

  return NextResponse.json({
    events: events.map((e) => ({
      type: e.type,
      label: e.label,
      confidence: e.confidence,
      timestamp: new Date(e.timestamp).toISOString(),
    })),
    totalEvents: events.length,
    rmsDb: latestResult?.rmsDb ?? -60,
    peakDb: latestResult?.peakDb ?? -60,
    criticalCount,
    warningCount,
    infoCount,
  });
}

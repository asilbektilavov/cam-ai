import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rbac';
import { crossCameraTracker } from '@/lib/services/cross-camera-tracker';

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
  const cameraA = searchParams.get('cameraA');
  const cameraB = searchParams.get('cameraB');

  if (!cameraA || !cameraB) {
    return NextResponse.json(
      { error: 'Query params "cameraA" and "cameraB" are required' },
      { status: 400 }
    );
  }

  const featuresA = crossCameraTracker.getRecentFeatures(cameraA);
  const featuresB = crossCameraTracker.getRecentFeatures(cameraB);

  if (featuresA.length === 0 || featuresB.length === 0) {
    return NextResponse.json({
      matches: [],
      totalMatches: 0,
      avgSimilarity: 0,
      lastUpdated: null,
      personsA: featuresA.length,
      personsB: featuresB.length,
    });
  }

  const vectorsA = featuresA.map((f) => f.features);
  const vectorsB = featuresB.map((f) => f.features);
  const matchResults = await crossCameraTracker.matchPersons(vectorsA, vectorsB);

  const matches = matchResults.map((m) => ({
    personA: featuresA[m.indexA]?.personId,
    personB: featuresB[m.indexB]?.personId,
    similarity: m.similarity,
    bboxA: featuresA[m.indexA]?.bbox,
    bboxB: featuresB[m.indexB]?.bbox,
    timestampA: featuresA[m.indexA]?.timestamp,
    timestampB: featuresB[m.indexB]?.timestamp,
  }));

  const avgSimilarity =
    matches.length > 0
      ? matches.reduce((sum, m) => sum + m.similarity, 0) / matches.length
      : 0;

  return NextResponse.json({
    matches,
    totalMatches: matches.length,
    avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
    lastUpdated: new Date().toISOString(),
    personsA: featuresA.length,
    personsB: featuresB.length,
  });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkPermission(session, 'view_analytics');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { cameraAId, cameraBId } = body;

  if (!cameraAId || !cameraBId) {
    return NextResponse.json(
      { error: 'cameraAId and cameraBId are required' },
      { status: 400 }
    );
  }

  if (cameraAId === cameraBId) {
    return NextResponse.json(
      { error: 'Cameras must be different' },
      { status: 400 }
    );
  }

  const featuresA = crossCameraTracker.getRecentFeatures(cameraAId);
  const featuresB = crossCameraTracker.getRecentFeatures(cameraBId);

  if (featuresA.length === 0 || featuresB.length === 0) {
    return NextResponse.json({
      matches: [],
      totalMatches: 0,
      avgSimilarity: 0,
      lastUpdated: new Date().toISOString(),
      personsA: featuresA.length,
      personsB: featuresB.length,
    });
  }

  const vectorsA = featuresA.map((f) => f.features);
  const vectorsB = featuresB.map((f) => f.features);
  const matchResults = await crossCameraTracker.matchPersons(vectorsA, vectorsB);

  const matches = matchResults.map((m) => ({
    personA: featuresA[m.indexA]?.personId,
    personB: featuresB[m.indexB]?.personId,
    similarity: m.similarity,
    bboxA: featuresA[m.indexA]?.bbox,
    bboxB: featuresB[m.indexB]?.bbox,
    timestampA: featuresA[m.indexA]?.timestamp,
    timestampB: featuresB[m.indexB]?.timestamp,
  }));

  const avgSimilarity =
    matches.length > 0
      ? matches.reduce((sum, m) => sum + m.similarity, 0) / matches.length
      : 0;

  return NextResponse.json({
    matches,
    totalMatches: matches.length,
    avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
    lastUpdated: new Date().toISOString(),
    personsA: featuresA.length,
    personsB: featuresB.length,
  });
}

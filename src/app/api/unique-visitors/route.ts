import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);

  const from = searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString();
  const to = searchParams.get('to') || new Date().toISOString();
  const cameraId = searchParams.get('cameraId') || '';

  try {
    // Unique visitors are computed from PersonSighting records.
    // Each unique SearchPerson with sightings = 1 unique visitor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sightingWhere: any = {
      searchPerson: { organizationId: orgId },
      timestamp: { gte: new Date(from), lte: new Date(to) },
    };

    if (cameraId) {
      sightingWhere.cameraId = cameraId;
    }

    // Count unique search persons with sightings in the period
    const sightings = await prisma.personSighting.findMany({
      where: sightingWhere,
      select: {
        searchPersonId: true,
        cameraId: true,
        timestamp: true,
        confidence: true,
      },
      orderBy: { timestamp: 'desc' },
    });

    // Compute unique visitors per day
    const uniquePerDay = new Map<string, Set<string>>();
    const uniquePerCamera = new Map<string, Set<string>>();

    for (const s of sightings) {
      const day = s.timestamp.toISOString().slice(0, 10);
      if (!uniquePerDay.has(day)) uniquePerDay.set(day, new Set());
      uniquePerDay.get(day)!.add(s.searchPersonId);

      if (!uniquePerCamera.has(s.cameraId)) uniquePerCamera.set(s.cameraId, new Set());
      uniquePerCamera.get(s.cameraId)!.add(s.searchPersonId);
    }

    // Get total unique count
    const allUnique = new Set(sightings.map((s) => s.searchPersonId));

    // Get camera names
    const cameraIds = Array.from(uniquePerCamera.keys());
    const cameras = await prisma.camera.findMany({
      where: { id: { in: cameraIds } },
      select: { id: true, name: true },
    });
    const cameraMap = new Map(cameras.map((c) => [c.id, c.name]));

    // Also compute approximate unique from people counter (non-face-based)
    // This uses AnalysisFrame peopleCount as approximation
    const frameWhere: Record<string, unknown> = {
      session: {
        camera: { organizationId: orgId },
      },
      capturedAt: { gte: new Date(from), lte: new Date(to) },
      peopleCount: { gt: 0 },
    };

    if (cameraId) {
      (frameWhere.session as Record<string, unknown>).cameraId = cameraId;
    }

    const totalPeopleFrames = await prisma.analysisFrame.aggregate({
      where: frameWhere,
      _sum: { peopleCount: true },
      _count: true,
    });

    // Simple heuristic: peak people count * sampling ratio = approximate visitors
    const maxPeople = await prisma.analysisFrame.aggregate({
      where: frameWhere,
      _max: { peopleCount: true },
    });

    return NextResponse.json({
      period: { from, to },
      uniqueByFace: allUnique.size,
      totalSightings: sightings.length,
      perDay: Array.from(uniquePerDay.entries())
        .map(([day, set]) => ({ day, unique: set.size }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      perCamera: Array.from(uniquePerCamera.entries()).map(([camId, set]) => ({
        cameraId: camId,
        cameraName: cameraMap.get(camId) || camId,
        unique: set.size,
      })),
      approximate: {
        totalFramesWithPeople: totalPeopleFrames._count,
        totalPeopleDetections: totalPeopleFrames._sum.peopleCount || 0,
        peakPeopleCount: maxPeople._max.peopleCount || 0,
      },
    });
  } catch (err) {
    console.error('[API /unique-visitors] Error:', err);
    return NextResponse.json({
      uniqueByFace: 0,
      totalSightings: 0,
      perDay: [],
      perCamera: [],
      approximate: { totalFramesWithPeople: 0, totalPeopleDetections: 0, peakPeopleCount: 0 },
    });
  }
}

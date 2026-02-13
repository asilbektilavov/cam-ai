import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(req.url);

  const objectType = searchParams.get('objectType') || '';
  const cameraId = searchParams.get('cameraId') || '';
  const triggerType = searchParams.get('triggerType') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    // Search in AnalysisFrame.detections (JSON) and .objects (JSON array)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      session: {
        camera: {
          organizationId: orgId,
        },
      },
    };

    if (cameraId) {
      where.session.camera.id = cameraId;
    }

    if (triggerType) {
      where.session.triggerType = triggerType;
    }

    if (from || to) {
      where.capturedAt = {};
      if (from) where.capturedAt.gte = new Date(from);
      if (to) where.capturedAt.lte = new Date(to);
    }

    // For object search, we need to search in the JSON detections field
    // Prisma doesn't support JSON field search directly, so we filter in code
    const frames = await prisma.analysisFrame.findMany({
      where: {
        ...where,
        detections: { not: null },
      },
      include: {
        session: {
          include: {
            camera: { select: { id: true, name: true, location: true } },
          },
        },
      },
      orderBy: { capturedAt: 'desc' },
      take: objectType ? 500 : limit, // Fetch more if filtering by type
      skip: objectType ? 0 : offset,
    });

    // Filter by object type if specified
    let filtered = frames;
    if (objectType) {
      filtered = frames.filter((frame) => {
        try {
          if (frame.detections) {
            const dets = JSON.parse(frame.detections) as Array<{ type?: string; label?: string }>;
            return dets.some(
              (d) =>
                d.type?.toLowerCase().includes(objectType.toLowerCase()) ||
                d.label?.toLowerCase().includes(objectType.toLowerCase())
            );
          }
          if (frame.objects) {
            const objs = JSON.parse(frame.objects) as string[];
            return objs.some((o) => o.toLowerCase().includes(objectType.toLowerCase()));
          }
          return false;
        } catch {
          return false;
        }
      });
    }

    const total = filtered.length;
    const paginated = objectType ? filtered.slice(offset, offset + limit) : filtered;

    const results = paginated.map((frame) => {
      let detections: Array<{ type: string; label: string; confidence: number }> = [];
      try {
        if (frame.detections) {
          detections = JSON.parse(frame.detections);
        }
      } catch { /* ignore */ }

      let objects: string[] = [];
      try {
        if (frame.objects) {
          objects = JSON.parse(frame.objects);
        }
      } catch { /* ignore */ }

      return {
        id: frame.id,
        capturedAt: frame.capturedAt,
        framePath: frame.framePath,
        description: frame.description,
        peopleCount: frame.peopleCount,
        objects,
        detections: detections.map((d: Record<string, unknown>) => ({
          type: d.type,
          label: d.label,
          confidence: d.confidence,
          ...(d.bbox ? { bbox: d.bbox } : {}),
          ...(d.color ? { color: d.color } : {}),
        })),
        camera: {
          id: frame.session.camera.id,
          name: frame.session.camera.name,
          location: frame.session.camera.location,
        },
        sessionId: frame.sessionId,
      };
    });

    // Get available object types for filter dropdown
    const objectTypesSet = new Set<string>();
    for (const frame of frames.slice(0, 200)) {
      try {
        if (frame.detections) {
          const dets = JSON.parse(frame.detections) as Array<{ label?: string }>;
          dets.forEach((d) => { if (d.label) objectTypesSet.add(d.label); });
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      results,
      total,
      availableTypes: Array.from(objectTypesSet).sort(),
    });
  } catch (err) {
    console.error('[API /object-search] Error:', err);
    return NextResponse.json({ results: [], total: 0, availableTypes: [] });
  }
}

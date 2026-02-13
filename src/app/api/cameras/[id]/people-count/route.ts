import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { peopleCounter } from '@/lib/services/people-counter';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_analytics');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Verify camera belongs to the user's organization
  const camera = await prisma.camera.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true },
  });

  if (!camera) return notFound('Camera not found');

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'current';

  switch (mode) {
    case 'current': {
      const count = peopleCounter.getCurrentCount(id);
      const readings = peopleCounter.getReadingsCount(id);
      console.log(`[PeopleCount] GET current: camera=${id}, count=${count}, readings=${readings}`);
      return NextResponse.json({
        cameraId: id,
        cameraName: camera.name,
        currentCount: count,
        totalReadings: readings,
      });
    }

    case 'hourly': {
      const date = searchParams.get('date');
      if (!date) {
        return badRequest('Parameter "date" is required for hourly mode (YYYY-MM-DD)');
      }
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return badRequest('Invalid date format. Expected YYYY-MM-DD');
      }

      const hourlyStats = peopleCounter.getHourlyStats(id, date);
      return NextResponse.json({
        cameraId: id,
        cameraName: camera.name,
        date,
        hourlyStats,
      });
    }

    case 'daily': {
      const daysParam = searchParams.get('days');
      const days = daysParam ? parseInt(daysParam, 10) : 7;

      if (isNaN(days) || days < 1 || days > 90) {
        return badRequest('Parameter "days" must be between 1 and 90');
      }

      const dailyStats = peopleCounter.getDailyStats(id, days);
      return NextResponse.json({
        cameraId: id,
        cameraName: camera.name,
        days,
        dailyStats,
      });
    }

    default:
      return badRequest('Invalid mode. Expected: current, hourly, or daily');
  }
}

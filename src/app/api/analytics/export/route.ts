import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_analytics');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'csv';
  const period = searchParams.get('period') || 'today';

  const now = new Date();
  let startDate: Date;

  switch (period) {
    case 'yesterday':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
  }

  const events = await prisma.event.findMany({
    where: {
      organizationId: orgId,
      timestamp: { gte: startDate },
    },
    include: { camera: true },
    orderBy: { timestamp: 'desc' },
  });

  if (format === 'csv') {
    const header = 'Дата,Время,Камера,Расположение,Тип,Важность,Описание\n';
    const rows = events.map((e) => {
      const d = new Date(e.timestamp);
      return [
        d.toLocaleDateString('ru-RU'),
        d.toLocaleTimeString('ru-RU'),
        `"${e.camera.name}"`,
        `"${e.camera.location}"`,
        e.type,
        e.severity,
        `"${e.description.replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csv = header + rows.join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="analytics-${period}.csv"`,
      },
    });
  }

  // JSON format
  return NextResponse.json({
    period,
    exportedAt: new Date().toISOString(),
    totalEvents: events.length,
    events: events.map((e) => ({
      timestamp: e.timestamp,
      camera: e.camera.name,
      location: e.camera.location,
      type: e.type,
      severity: e.severity,
      description: e.description,
    })),
  });
}

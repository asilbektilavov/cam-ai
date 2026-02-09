import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

const TYPE_LABELS: Record<string, string> = {
  motion_detected: 'Детекция движения',
  alert: 'Алерт безопасности',
  face_detected: 'Распознавание лиц',
  people_count: 'Подсчёт людей',
  suspicious_behavior: 'Подозрительное поведение',
  queue_detected: 'Длинная очередь',
  fire_detected: 'Обнаружение огня',
  smoke_detected: 'Обнаружение дыма',
  ppe_violation: 'Нарушение СИЗ',
  plate_detected: 'Номер распознан',
  line_crossing: 'Пересечение линии',
  abandoned_object: 'Оставленный предмет',
  tamper_detected: 'Саботаж камеры',
  fall_detected: 'Обнаружение падения',
  crowd: 'Скопление людей',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Критический',
  warning: 'Предупреждение',
  info: 'Информация',
};

function getStartDate(period: string): Date {
  const now = new Date();
  const startDate = new Date(now);

  switch (period) {
    case 'yesterday':
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      startDate.setHours(0, 0, 0, 0);
  }

  return startDate;
}

export async function GET(request: Request) {
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

  const orgId = session.user.organizationId;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'csv';
  const period = searchParams.get('period') || 'today';

  const startDate = getStartDate(period);

  const events = await prisma.event.findMany({
    where: {
      organizationId: orgId,
      timestamp: { gte: startDate },
    },
    include: { camera: true },
    orderBy: { timestamp: 'desc' },
  });

  // ── CSV ──
  if (format === 'csv') {
    const header = 'Дата,Время,Камера,Расположение,Тип,Важность,Описание\n';
    const rows = events.map((e) => {
      const d = new Date(e.timestamp);
      return [
        d.toLocaleDateString('ru-RU'),
        d.toLocaleTimeString('ru-RU'),
        `"${e.camera.name}"`,
        `"${e.camera.location}"`,
        TYPE_LABELS[e.type] || e.type,
        SEVERITY_LABELS[e.severity] || e.severity,
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

  // ── Excel (XLSX) ──
  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CamAI';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Аналитика');

    // Header row
    sheet.columns = [
      { header: 'Дата', key: 'date', width: 14 },
      { header: 'Время', key: 'time', width: 12 },
      { header: 'Камера', key: 'camera', width: 25 },
      { header: 'Расположение', key: 'location', width: 25 },
      { header: 'Тип события', key: 'type', width: 22 },
      { header: 'Важность', key: 'severity', width: 16 },
      { header: 'Описание', key: 'description', width: 50 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };

    // Data rows
    for (const e of events) {
      const d = new Date(e.timestamp);
      const row = sheet.addRow({
        date: d.toLocaleDateString('ru-RU'),
        time: d.toLocaleTimeString('ru-RU'),
        camera: e.camera.name,
        location: e.camera.location,
        type: TYPE_LABELS[e.type] || e.type,
        severity: SEVERITY_LABELS[e.severity] || e.severity,
        description: e.description,
      });

      // Color severity
      const severityCell = row.getCell('severity');
      if (e.severity === 'critical') {
        severityCell.font = { color: { argb: 'FFDC2626' }, bold: true };
      } else if (e.severity === 'warning') {
        severityCell.font = { color: { argb: 'FFD97706' } };
      }
    }

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Сводка');
    summarySheet.columns = [
      { header: 'Показатель', key: 'metric', width: 30 },
      { header: 'Значение', key: 'value', width: 20 },
    ];

    const summaryHeaderRow = summarySheet.getRow(1);
    summaryHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' },
    };

    // Count by type
    const typeCounts: Record<string, number> = {};
    const severityCounts: Record<string, number> = {};
    for (const e of events) {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
      severityCounts[e.severity] = (severityCounts[e.severity] || 0) + 1;
    }

    summarySheet.addRow({ metric: 'Период', value: period });
    summarySheet.addRow({ metric: 'Всего событий', value: events.length });
    summarySheet.addRow({ metric: 'Критических', value: severityCounts['critical'] || 0 });
    summarySheet.addRow({ metric: 'Предупреждений', value: severityCounts['warning'] || 0 });
    summarySheet.addRow({ metric: 'Информационных', value: severityCounts['info'] || 0 });
    summarySheet.addRow({ metric: '', value: '' });

    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      summarySheet.addRow({ metric: TYPE_LABELS[type] || type, value: count });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="analytics-${period}.xlsx"`,
      },
    });
  }

  // ── PDF ──
  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Title
    doc.setFontSize(18);
    doc.text('CamAI — Отчёт аналитики', 14, 20);

    doc.setFontSize(10);
    doc.text(`Период: ${period} | Экспорт: ${new Date().toLocaleString('ru-RU')} | Всего событий: ${events.length}`, 14, 28);

    // Table
    const tableData = events.map((e) => {
      const d = new Date(e.timestamp);
      return [
        d.toLocaleDateString('ru-RU'),
        d.toLocaleTimeString('ru-RU'),
        e.camera.name,
        e.camera.location,
        TYPE_LABELS[e.type] || e.type,
        SEVERITY_LABELS[e.severity] || e.severity,
        e.description.substring(0, 80),
      ];
    });

    autoTable(doc, {
      head: [['Дата', 'Время', 'Камера', 'Расположение', 'Тип', 'Важность', 'Описание']],
      body: tableData,
      startY: 34,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        6: { cellWidth: 60 },
      },
    });

    const pdfBuffer = doc.output('arraybuffer');

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="analytics-${period}.pdf"`,
      },
    });
  }

  // ── JSON (default) ──
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

import { prisma } from '@/lib/prisma';
import nodemailer from 'nodemailer';

class ReportScheduler {
  private static instance: ReportScheduler;
  private started = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  static getInstance(): ReportScheduler {
    if (!ReportScheduler.instance) {
      ReportScheduler.instance = new ReportScheduler();
    }
    return ReportScheduler.instance;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // Check every hour
    this.intervalHandle = setInterval(() => void this.checkAndSend(), 60 * 60 * 1000);
    console.log('[ReportScheduler] Started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.started = false;
  }

  private async checkAndSend(): Promise<void> {
    const now = new Date();
    const hour = now.getUTCHours();

    try {
      // Daily reports at 09:00 UTC (14:00 Tashkent)
      if (hour === 9) {
        await this.sendReports('daily');
      }

      // Weekly reports on Monday at 09:00 UTC
      if (now.getUTCDay() === 1 && hour === 9) {
        await this.sendReports('weekly');
      }
    } catch (error) {
      console.error('[ReportScheduler] Error:', error);
    }
  }

  private async sendReports(type: 'daily' | 'weekly'): Promise<void> {
    const settingsField = type === 'daily' ? 'notifDailyReport' : 'notifWeeklyReport';

    const users = await prisma.user.findMany({
      where: {
        settings: { [settingsField]: true },
      },
      include: {
        organization: true,
        settings: true,
      },
    });

    if (users.length === 0) return;

    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;

    if (!smtpHost || !smtpUser) {
      console.log(`[ReportScheduler] SMTP not configured, skipping ${type} reports`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    // Group users by organization
    const orgUsers = new Map<string, typeof users>();
    for (const user of users) {
      const list = orgUsers.get(user.organizationId) || [];
      list.push(user);
      orgUsers.set(user.organizationId, list);
    }

    for (const [orgId, orgUserList] of orgUsers) {
      try {
        const report = await this.composeReport(orgId, type === 'daily' ? 24 : 168);
        const subject = type === 'daily'
          ? `[CamAI] Ежедневный отчёт — ${new Date().toLocaleDateString('ru-RU')}`
          : `[CamAI] Еженедельный отчёт — неделя ${this.getWeekNumber(new Date())}`;

        for (const user of orgUserList) {
          try {
            await transporter.sendMail({
              from: smtpFrom,
              to: user.email,
              subject,
              html: report,
            });
          } catch (err) {
            console.error(`[ReportScheduler] Failed to send to ${user.email}:`, err);
          }
        }

        console.log(`[ReportScheduler] Sent ${type} report for org ${orgId} to ${orgUserList.length} users`);
      } catch (err) {
        console.error(`[ReportScheduler] Failed to compose report for org ${orgId}:`, err);
      }
    }
  }

  private async composeReport(orgId: string, hours: number): Promise<string> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [org, cameraCount, onlineCameras, events, eventsByType, eventsBySeverity] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
      prisma.camera.count({ where: { organizationId: orgId } }),
      prisma.camera.count({ where: { organizationId: orgId, status: 'online' } }),
      prisma.event.count({ where: { organizationId: orgId, timestamp: { gte: since } } }),
      prisma.event.groupBy({
        by: ['type'],
        where: { organizationId: orgId, timestamp: { gte: since } },
        _count: true,
        orderBy: { _count: { type: 'desc' } },
        take: 5,
      }),
      prisma.event.groupBy({
        by: ['severity'],
        where: { organizationId: orgId, timestamp: { gte: since } },
        _count: true,
      }),
    ]);

    const period = hours === 24 ? 'за последние 24 часа' : 'за последнюю неделю';
    const criticalCount = eventsBySeverity.find(e => e.severity === 'critical')?._count || 0;
    const warningCount = eventsBySeverity.find(e => e.severity === 'warning')?._count || 0;

    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2 style="color:#2563eb">CamAI — Отчёт ${period}</h2>
        <p>Организация: <strong>${org?.name || 'N/A'}</strong></p>
        <hr style="border:1px solid #eee"/>
        <h3>Камеры</h3>
        <p>Всего: <strong>${cameraCount}</strong> | Онлайн: <strong>${onlineCameras}</strong></p>
        <h3>События ${period}</h3>
        <p>Всего: <strong>${events}</strong></p>
        <ul>
          <li style="color:#ef4444">Критические: <strong>${criticalCount}</strong></li>
          <li style="color:#f59e0b">Предупреждения: <strong>${warningCount}</strong></li>
        </ul>
        ${eventsByType.length > 0 ? `
          <h3>Топ событий по типу</h3>
          <ul>
            ${eventsByType.map(e => `<li>${e.type}: <strong>${e._count}</strong></li>`).join('')}
          </ul>
        ` : ''}
        <hr style="border:1px solid #eee"/>
        <p style="color:#666;font-size:12px">Этот отчёт отправлен автоматически. Настройте рассылку в разделе Настройки → Уведомления.</p>
      </div>
    `;
  }

  private getWeekNumber(date: Date): number {
    const oneJan = new Date(date.getFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  }
}

export const reportScheduler = ReportScheduler.getInstance();

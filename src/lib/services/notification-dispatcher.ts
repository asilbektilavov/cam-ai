import { prisma } from '@/lib/prisma';
import { appEvents, SmartAlert } from './event-emitter';
import nodemailer from 'nodemailer';

class NotificationDispatcher {
  private static instance: NotificationDispatcher;
  private started = false;

  static getInstance(): NotificationDispatcher {
    if (!NotificationDispatcher.instance) {
      NotificationDispatcher.instance = new NotificationDispatcher();
    }
    return NotificationDispatcher.instance;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    appEvents.on('smart-alert', (alert: SmartAlert) => {
      void this.handleAlert(alert);
    });
    console.log('[NotificationDispatcher] Started');
  }

  private async handleAlert(alert: SmartAlert): Promise<void> {
    if (!alert.integrationId) {
      // No integration configured — only SSE (already emitted)
      return;
    }

    try {
      const integration = await prisma.integration.findUnique({
        where: { id: alert.integrationId },
      });

      if (!integration || !integration.enabled) {
        console.log(`[NotificationDispatcher] Integration ${alert.integrationId} not found or disabled`);
        return;
      }

      const config = JSON.parse(integration.config) as Record<string, string>;

      // Resolve branch name for the message
      let branchName: string | null = null;
      if (alert.branchId) {
        const branch = await prisma.branch.findUnique({
          where: { id: alert.branchId },
          select: { name: true },
        });
        branchName = branch?.name || null;
      }

      const message = this.formatMessage(alert, branchName);

      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          organizationId: alert.organizationId,
          integrationId: integration.id,
          featureType: alert.featureType,
          cameraId: alert.cameraId,
          message,
          status: 'pending',
        },
      });

      try {
        switch (integration.type) {
          case 'telegram':
            await this.sendTelegram(config, message, alert);
            break;
          case 'webhook':
            await this.sendWebhook(config, alert, message);
            break;
          case 'slack':
            await this.sendSlack(config, message);
            break;
          case 'email':
            await this.sendEmail(config, message, alert);
            break;
          default:
            console.log(`[NotificationDispatcher] Unsupported type: ${integration.type}`);
            await prisma.notification.update({
              where: { id: notification.id },
              data: { status: 'failed', error: `Unsupported type: ${integration.type}` },
            });
            return;
        }

        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'sent', sentAt: new Date() },
        });

        console.log(`[NotificationDispatcher] Sent ${integration.type} notification for ${alert.featureType}`);
      } catch (sendError) {
        const errorMsg = sendError instanceof Error ? sendError.message : 'Unknown error';
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'failed', error: errorMsg },
        });
        console.error(`[NotificationDispatcher] Failed to send:`, errorMsg);
      }
    } catch (error) {
      console.error('[NotificationDispatcher] Error handling alert:', error);
    }
  }

  private formatMessage(alert: SmartAlert, branchName?: string | null): string {
    const featureLabels: Record<string, string> = {
      queue_monitor: 'Контроль очередей',
      person_search: 'Поиск человека',
      loitering_detection: 'Детекция праздношатания',
      workstation_monitor: 'Контроль рабочей зоны',
      fire_smoke_detection: 'Детекция огня/дыма',
      ppe_detection: 'Контроль СИЗ',
      lpr_detection: 'Распознавание номеров',
      line_crossing: 'Пересечение линии',
      heatmap_tracking: 'Тепловая карта',
      abandoned_object: 'Оставленный предмет',
      tamper_detection: 'Обнаружение саботажа',
      fall_detection: 'Обнаружение падения',
    };

    const severityIcons: Record<string, string> = {
      critical: '🔴',
      warning: '🟡',
      info: 'ℹ️',
    };

    const icon = severityIcons[alert.severity] || '📢';
    const feature = featureLabels[alert.featureType] || alert.featureType;

    const lines = [
      `${icon} ${feature}`,
      `📷 ${alert.cameraName} (${alert.cameraLocation})`,
    ];

    if (branchName) {
      lines.push(`🏢 ${branchName}`);
    }

    lines.push('', alert.message, '', `🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}`);

    return lines.join('\n');
  }

  private async sendTelegram(config: Record<string, string>, message: string, alert: SmartAlert): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || config.botToken;
    const { chatId } = config;
    if (!botToken || !chatId) {
      throw new Error('Telegram: botToken и chatId обязательны');
    }

    // Filter by branch notification settings
    if (config.notifyBranches) {
      try {
        const allowedBranches = JSON.parse(config.notifyBranches) as string[];
        if (allowedBranches.length > 0 && !allowedBranches.includes(alert.branchId)) {
          return;
        }
      } catch { /* invalid JSON — send anyway */ }
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Telegram API error: ${JSON.stringify(body)}`);
    }
  }

  private async sendWebhook(
    config: Record<string, string>,
    alert: SmartAlert,
    message: string
  ): Promise<void> {
    const { url, secret } = config;
    if (!url) {
      throw new Error('Webhook: URL обязателен');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers['X-Webhook-Secret'] = secret;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'cam-ai',
        featureType: alert.featureType,
        cameraId: alert.cameraId,
        cameraName: alert.cameraName,
        severity: alert.severity,
        message,
        metadata: alert.metadata,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}`);
    }
  }

  private async sendSlack(config: Record<string, string>, message: string): Promise<void> {
    const { webhookUrl } = config;
    if (!webhookUrl) {
      throw new Error('Slack: webhookUrl обязателен');
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message,
      }),
    });

    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`);
    }
  }

  private async sendEmail(
    config: Record<string, string>,
    message: string,
    alert: SmartAlert
  ): Promise<void> {
    const { smtpHost, smtpPort, smtpUser, smtpPass, recipients, fromName, useTls } = config;
    if (!smtpHost || !recipients) {
      throw new Error('Email: smtpHost и recipients обязательны');
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '587', 10),
      secure: useTls === 'true' || parseInt(smtpPort || '587', 10) === 465,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass || '' } : undefined,
    });

    const severityColors: Record<string, string> = {
      critical: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
    };

    const featureLabels: Record<string, string> = {
      queue_monitor: 'Контроль очередей',
      person_search: 'Поиск человека',
      loitering_detection: 'Детекция праздношатания',
      workstation_monitor: 'Контроль рабочей зоны',
      fire_smoke_detection: 'Детекция огня/дыма',
      ppe_detection: 'Контроль СИЗ',
      lpr_detection: 'Распознавание номеров',
      line_crossing: 'Пересечение линии',
      abandoned_object: 'Оставленный предмет',
      tamper_detection: 'Саботаж камеры',
      fall_detection: 'Обнаружение падения',
    };

    const color = severityColors[alert.severity] || '#6b7280';
    const featureLabel = featureLabels[alert.featureType] || alert.featureType;
    const time = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:${color};color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">${featureLabel}</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          <p style="margin:0 0 12px;"><strong>Камера:</strong> ${alert.cameraName} (${alert.cameraLocation})</p>
          <p style="margin:0 0 12px;"><strong>Серьёзность:</strong> ${alert.severity}</p>
          <p style="margin:0 0 12px;"><strong>Описание:</strong><br/>${alert.message}</p>
          <p style="margin:0;color:#6b7280;font-size:13px;">${time}</p>
        </div>
        <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">CamAI — Система видеоаналитики</p>
      </div>
    `;

    const recipientList = recipients.split(',').map((e: string) => e.trim()).filter(Boolean);

    await transporter.sendMail({
      from: `"${fromName || 'CamAI'}" <${smtpUser || 'noreply@camai.local'}>`,
      to: recipientList.join(', '),
      subject: `[CamAI] ${featureLabel} — ${alert.cameraName}`,
      text: message,
      html,
    });
  }
}

export const notificationDispatcher = NotificationDispatcher.getInstance();

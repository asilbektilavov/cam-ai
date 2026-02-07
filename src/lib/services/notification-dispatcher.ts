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
          case 'sms':
            await this.sendSms(config, message);
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

  private async sendEmail(config: Record<string, string>, message: string, alert: SmartAlert): Promise<void> {
    const { smtpServer, smtpPort, email, smtpPassword } = config;
    if (!smtpServer || !email) {
      throw new Error('Email: smtpServer и email обязательны');
    }

    const transporter = nodemailer.createTransport({
      host: smtpServer,
      port: parseInt(smtpPort || '587', 10),
      secure: parseInt(smtpPort || '587', 10) === 465,
      auth: smtpPassword ? { user: email, pass: smtpPassword } : undefined,
    });

    const featureLabels: Record<string, string> = {
      queue_monitor: 'Контроль очередей',
      person_search: 'Поиск человека',
      loitering_detection: 'Детекция праздношатания',
      workstation_monitor: 'Контроль рабочей зоны',
    };

    const subject = `[CamAI] ${featureLabels[alert.featureType] || alert.featureType} — ${alert.severity}`;

    await transporter.sendMail({
      from: email,
      to: email,
      subject,
      text: message,
    });
  }

  private async sendSms(config: Record<string, string>, message: string): Promise<void> {
    const { apiEmail, apiPassword, phone } = config;
    if (!apiEmail || !apiPassword || !phone) {
      throw new Error('SMS: apiEmail, apiPassword и phone обязательны');
    }

    // Authenticate with Eskiz.uz
    const authRes = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: apiEmail, password: apiPassword }),
    });
    if (!authRes.ok) throw new Error(`Eskiz auth failed: ${authRes.status}`);
    const authData = await authRes.json() as { data?: { token?: string } };
    const token = authData.data?.token;
    if (!token) throw new Error('Eskiz: no token received');

    // Send SMS
    const smsRes = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mobile_phone: phone.replace(/^\+/, ''),
        message: message.substring(0, 160),
        from: '4546',
      }),
    });
    if (!smsRes.ok) throw new Error(`Eskiz SMS failed: ${smsRes.status}`);
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
}

export const notificationDispatcher = NotificationDispatcher.getInstance();

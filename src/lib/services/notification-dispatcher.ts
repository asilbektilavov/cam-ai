import { prisma } from '@/lib/prisma';
import { appEvents, SmartAlert } from './event-emitter';

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
      const message = this.formatMessage(alert);

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
            await this.sendTelegram(config, message);
            break;
          case 'webhook':
            await this.sendWebhook(config, alert, message);
            break;
          case 'slack':
            await this.sendSlack(config, message);
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

  private formatMessage(alert: SmartAlert): string {
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

    return [
      `${icon} ${feature}`,
      `📷 ${alert.cameraName} (${alert.cameraLocation})`,
      ``,
      alert.message,
      ``,
      `🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}`,
    ].join('\n');
  }

  private async sendTelegram(config: Record<string, string>, message: string): Promise<void> {
    const { botToken, chatId } = config;
    if (!botToken || !chatId) {
      throw new Error('Telegram: botToken и chatId обязательны');
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
}

export const notificationDispatcher = NotificationDispatcher.getInstance();

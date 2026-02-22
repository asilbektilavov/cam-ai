import { prisma } from '@/lib/prisma';
import { appEvents, SmartAlert } from './event-emitter';
import nodemailer from 'nodemailer';

// Process-level keys for HMR survival
const STATE_KEY = '__camai_notifState__';
const LISTENER_KEY = '__camai_notifListener__';

interface NotifState {
  lastSent: Map<string, number>;
}

// Get or create process-level state (survives HMR, preserves cooldown timers)
function getState(): NotifState {
  const proc = process as unknown as Record<string, NotifState | undefined>;
  if (!proc[STATE_KEY]) {
    proc[STATE_KEY] = { lastSent: new Map() };
  }
  return proc[STATE_KEY]!;
}

const COOLDOWN_MS = 120_000;

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

function formatMessage(alert: SmartAlert, branchName?: string | null): string {
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

async function sendTelegram(config: Record<string, string>, message: string, alert: SmartAlert): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || config.botToken;
  const { chatId } = config;
  if (!botToken || !chatId) {
    throw new Error('Telegram: botToken и chatId обязательны');
  }

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

async function sendWebhook(
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

async function sendSlack(config: Record<string, string>, message: string): Promise<void> {
  const { webhookUrl } = config;
  if (!webhookUrl) {
    throw new Error('Slack: webhookUrl обязателен');
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}`);
  }
}

async function sendEmail(
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
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">DSS — Система видеоаналитики</p>
    </div>
  `;

  const recipientList = recipients.split(',').map((e: string) => e.trim()).filter(Boolean);

  await transporter.sendMail({
    from: `"${fromName || 'DSS'}" <${smtpUser || 'noreply@camai.local'}>`,
    to: recipientList.join(', '),
    subject: `[DSS] ${featureLabel} — ${alert.cameraName}`,
    text: message,
    html,
  });
}

// Main alert handler — uses module-level functions so HMR always gets latest code
async function handleAlert(alert: SmartAlert): Promise<void> {
  const state = getState();
  const cooldownKey = `${alert.featureType}:${alert.cameraId}`;
  const now = Date.now();
  const lastTime = state.lastSent.get(cooldownKey) || 0;
  if (now - lastTime < COOLDOWN_MS) {
    return;
  }

  try {
    let integration;

    if (alert.integrationId) {
      integration = await prisma.integration.findUnique({
        where: { id: alert.integrationId },
      });
    } else if (alert.organizationId) {
      integration = await prisma.integration.findFirst({
        where: {
          organizationId: alert.organizationId,
          enabled: true,
          type: { in: ['telegram', 'slack', 'webhook', 'email'] },
        },
        orderBy: { type: 'asc' },
      });
    }

    if (!integration || !integration.enabled) {
      return;
    }

    const config = JSON.parse(integration.config) as Record<string, string>;

    let branchName: string | null = null;
    if (alert.branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: alert.branchId },
        select: { name: true },
      });
      branchName = branch?.name || null;
    }

    const message = formatMessage(alert, branchName);

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
          await sendTelegram(config, message, alert);
          break;
        case 'webhook':
          await sendWebhook(config, alert, message);
          break;
        case 'slack':
          await sendSlack(config, message);
          break;
        case 'email':
          await sendEmail(config, message, alert);
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

      state.lastSent.set(cooldownKey, Date.now());
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

// NotificationDispatcher — thin wrapper for start/stop, class kept for API compat
class NotificationDispatcher {
  start(): void {
    const proc = process as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;

    // Remove previous listener (HMR may have replaced module code)
    if (proc[LISTENER_KEY]) {
      appEvents.removeListener('smart-alert', proc[LISTENER_KEY] as (alert: SmartAlert) => void);
    }

    // Fresh listener using current module-level handleAlert (always latest code)
    const listener = (alert: SmartAlert) => {
      void handleAlert(alert);
    };
    proc[LISTENER_KEY] = listener as (...args: unknown[]) => void;
    appEvents.on('smart-alert', listener);

    console.log('[NotificationDispatcher] Listener active');
  }
}

export const notificationDispatcher = new NotificationDispatcher();

// Auto-start on server-side import — refreshes listener on every HMR reload
if (process.env.NEXT_RUNTIME === 'nodejs') {
  notificationDispatcher.start();
}

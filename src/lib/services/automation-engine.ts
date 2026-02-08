import { prisma } from '@/lib/prisma';
import { appEvents, CameraEvent } from './event-emitter';

// ── Types ──────────────────────────────────────────────────────────────

interface AutomationTrigger {
  eventType: string | null;
  severity: string[];
  cameraId: string | null;
  schedule: { from: string; to: string } | null;
}

interface AutomationAction {
  type: 'notify_telegram' | 'notify_slack' | 'notify_webhook' | 'create_event';
  message?: string;
}

interface RuleRecord {
  id: string;
  organizationId: string;
  name: string;
  trigger: string;
  conditions: string;
  actions: string;
  enabled: boolean;
  lastTriggeredAt: Date | null;
  triggerCount: number;
}

// ── Cooldown tracking ──────────────────────────────────────────────────

const COOLDOWN_MS = 60_000; // 60 seconds per rule

// ── Singleton ──────────────────────────────────────────────────────────

class AutomationEngine {
  private static instance: AutomationEngine;
  private started = false;
  /** ruleId -> timestamp of last execution */
  private lastFired = new Map<string, number>();

  static getInstance(): AutomationEngine {
    if (!AutomationEngine.instance) {
      AutomationEngine.instance = new AutomationEngine();
    }
    return AutomationEngine.instance;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Listen for all camera events
    appEvents.on('camera-event', (event: CameraEvent) => {
      void this.handleEvent(event);
    });

    // Also listen for smart-alert events (they carry severity)
    appEvents.on('smart-alert', (alert: {
      featureType: string;
      cameraId: string;
      organizationId: string;
      branchId: string;
      severity: string;
      cameraName: string;
      cameraLocation: string;
      message: string;
      metadata: Record<string, unknown>;
    }) => {
      // Map smart-alert to a CameraEvent shape for unified processing
      const syntheticEvent: CameraEvent = {
        type: alert.featureType as CameraEvent['type'],
        cameraId: alert.cameraId,
        organizationId: alert.organizationId,
        branchId: alert.branchId,
        data: {
          severity: alert.severity,
          cameraName: alert.cameraName,
          cameraLocation: alert.cameraLocation,
          message: alert.message,
          ...alert.metadata,
        },
      };
      void this.handleEvent(syntheticEvent);
    });

    console.log('[AutomationEngine] Started');
  }

  // ── Core handler ───────────────────────────────────────────────────

  private async handleEvent(event: CameraEvent): Promise<void> {
    try {
      const rules = await prisma.automationRule.findMany({
        where: { organizationId: event.organizationId, enabled: true },
      });

      for (const rule of rules) {
        try {
          if (this.isInCooldown(rule.id)) continue;

          const trigger = this.parseTrigger(rule.trigger);
          const actions = this.parseActions(rule.actions);

          if (!this.matchesTrigger(trigger, event)) continue;

          console.log(`[AutomationEngine] Rule "${rule.name}" matched event ${event.type}`);

          // Mark cooldown
          this.lastFired.set(rule.id, Date.now());

          // Execute actions
          await this.executeActions(actions, event, rule);

          // Update rule stats
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: {
              lastTriggeredAt: new Date(),
              triggerCount: { increment: 1 },
            },
          });
        } catch (ruleError) {
          console.error(`[AutomationEngine] Error processing rule ${rule.id}:`, ruleError);
        }
      }
    } catch (error) {
      console.error('[AutomationEngine] Error handling event:', error);
    }
  }

  // ── Trigger matching ───────────────────────────────────────────────

  private matchesTrigger(trigger: AutomationTrigger, event: CameraEvent): boolean {
    // Match event type
    if (trigger.eventType && trigger.eventType !== event.type) {
      return false;
    }

    // Match severity (if specified)
    if (trigger.severity && trigger.severity.length > 0) {
      const eventSeverity = (event.data?.severity as string) || 'info';
      if (!trigger.severity.includes(eventSeverity)) {
        return false;
      }
    }

    // Match camera (if specified)
    if (trigger.cameraId && trigger.cameraId !== event.cameraId) {
      return false;
    }

    // Match time schedule (if specified)
    if (trigger.schedule && trigger.schedule.from && trigger.schedule.to) {
      if (!this.isWithinSchedule(trigger.schedule.from, trigger.schedule.to)) {
        return false;
      }
    }

    return true;
  }

  private isWithinSchedule(from: string, to: string): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    const fromMinutes = fh * 60 + fm;
    const toMinutes = th * 60 + tm;

    if (fromMinutes <= toMinutes) {
      // Same-day range: e.g. 08:00 – 18:00
      return currentMinutes >= fromMinutes && currentMinutes <= toMinutes;
    } else {
      // Overnight range: e.g. 22:00 – 06:00
      return currentMinutes >= fromMinutes || currentMinutes <= toMinutes;
    }
  }

  private isInCooldown(ruleId: string): boolean {
    const last = this.lastFired.get(ruleId);
    if (!last) return false;
    return Date.now() - last < COOLDOWN_MS;
  }

  // ── Action execution ───────────────────────────────────────────────

  private async executeActions(
    actions: AutomationAction[],
    event: CameraEvent,
    rule: RuleRecord
  ): Promise<void> {
    // Resolve camera name for message templates
    let cameraName = (event.data?.cameraName as string) || '';
    let cameraLocation = (event.data?.cameraLocation as string) || '';
    if (!cameraName && event.cameraId) {
      try {
        const cam = await prisma.camera.findUnique({
          where: { id: event.cameraId },
          select: { name: true, location: true },
        });
        if (cam) {
          cameraName = cam.name;
          cameraLocation = cam.location;
        }
      } catch { /* ignore */ }
    }

    for (const action of actions) {
      try {
        const message = this.formatMessage(
          action.message || 'Событие {event} на камере {camera} в {time}',
          event,
          cameraName,
          cameraLocation
        );

        switch (action.type) {
          case 'notify_telegram':
            await this.sendTelegram(event.organizationId, message);
            break;
          case 'notify_slack':
            await this.sendSlack(event.organizationId, message);
            break;
          case 'notify_webhook':
            await this.sendWebhook(event.organizationId, message, event);
            break;
          case 'create_event':
            await this.createEvent(event, message, rule);
            break;
          default:
            console.warn(`[AutomationEngine] Unknown action type: ${action.type}`);
        }
      } catch (actionError) {
        console.error(`[AutomationEngine] Action ${action.type} failed:`, actionError);
      }
    }
  }

  // ── Message formatting ─────────────────────────────────────────────

  private formatMessage(
    template: string,
    event: CameraEvent,
    cameraName: string,
    cameraLocation: string
  ): string {
    const eventLabels: Record<string, string> = {
      fire_detected: 'Огонь',
      smoke_detected: 'Дым',
      motion_detected: 'Движение',
      alert: 'Тревога',
      smart_alert: 'Умная тревога',
      line_crossing: 'Пересечение линии',
      queue_alert: 'Длинная очередь',
      abandoned_object: 'Оставленный предмет',
      tamper_detected: 'Саботаж камеры',
      ppe_violation: 'Нарушение СИЗ',
      plate_detected: 'Номер авто',
      person_sighting: 'Обнаружен человек',
    };

    const eventLabel = eventLabels[event.type] || event.type;
    const time = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });

    return template
      .replace(/\{event\}/g, eventLabel)
      .replace(/\{camera\}/g, cameraName || 'Неизвестная камера')
      .replace(/\{location\}/g, cameraLocation || '')
      .replace(/\{time\}/g, time)
      .replace(/\{severity\}/g, (event.data?.severity as string) || 'info')
      .replace(/\{type\}/g, event.type);
  }

  // ── Notification senders ───────────────────────────────────────────

  private async sendTelegram(orgId: string, message: string): Promise<void> {
    const integration = await prisma.integration.findFirst({
      where: { organizationId: orgId, type: 'telegram', enabled: true },
    });
    if (!integration) {
      console.warn('[AutomationEngine] No active Telegram integration found');
      return;
    }

    const config = JSON.parse(integration.config) as Record<string, string>;
    const botToken = process.env.TELEGRAM_BOT_TOKEN || config.botToken;
    const chatId = config.chatId;
    if (!botToken || !chatId) return;

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

  private async sendSlack(orgId: string, message: string): Promise<void> {
    const integration = await prisma.integration.findFirst({
      where: { organizationId: orgId, type: 'slack', enabled: true },
    });
    if (!integration) {
      console.warn('[AutomationEngine] No active Slack integration found');
      return;
    }

    const config = JSON.parse(integration.config) as Record<string, string>;
    const { webhookUrl } = config;
    if (!webhookUrl) return;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });

    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`);
    }
  }

  private async sendWebhook(
    orgId: string,
    message: string,
    event: CameraEvent
  ): Promise<void> {
    const integration = await prisma.integration.findFirst({
      where: { organizationId: orgId, type: 'webhook', enabled: true },
    });
    if (!integration) {
      console.warn('[AutomationEngine] No active Webhook integration found');
      return;
    }

    const config = JSON.parse(integration.config) as Record<string, string>;
    const { url, secret } = config;
    if (!url) return;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Webhook-Secret'] = secret;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'cam-ai-automation',
        eventType: event.type,
        cameraId: event.cameraId,
        message,
        data: event.data,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}`);
    }
  }

  private async createEvent(
    event: CameraEvent,
    message: string,
    rule: RuleRecord
  ): Promise<void> {
    await prisma.event.create({
      data: {
        cameraId: event.cameraId,
        organizationId: event.organizationId,
        branchId: event.branchId || undefined,
        type: `automation:${event.type}`,
        severity: (event.data?.severity as string) || 'info',
        description: `[Автоматизация: ${rule.name}] ${message}`,
        metadata: JSON.stringify({
          ruleId: rule.id,
          ruleName: rule.name,
          originalEvent: event.type,
        }),
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private parseTrigger(raw: string): AutomationTrigger {
    try {
      const parsed = JSON.parse(raw);
      return {
        eventType: parsed.eventType || null,
        severity: Array.isArray(parsed.severity) ? parsed.severity : [],
        cameraId: parsed.cameraId || null,
        schedule: parsed.schedule || null,
      };
    } catch {
      return { eventType: null, severity: [], cameraId: null, schedule: null };
    }
  }

  private parseActions(raw: string): AutomationAction[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

export const automationEngine = AutomationEngine.getInstance();

import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

// Default integrations template
const DEFAULT_INTEGRATIONS = [
  { type: 'telegram', name: 'Telegram', category: 'notifications', description: 'Уведомления через Telegram-бот' },
  { type: 'slack', name: 'Slack', category: 'notifications', description: 'Алерты в Slack-каналы' },
  { type: 'email', name: 'Email SMTP', category: 'notifications', description: 'Уведомления на email' },
  { type: 'sms', name: 'SMS', category: 'notifications', description: 'SMS-уведомления' },
  { type: '1c', name: '1С:Предприятие', category: 'crm', description: 'Интеграция с 1С' },
  { type: 'bitrix', name: 'Битрикс24', category: 'crm', description: 'CRM и задачи' },
  { type: 'iiko', name: 'iiko', category: 'access', description: 'POS-система для ресторанов' },
  { type: 'skud', name: 'СКУД', category: 'access', description: 'Система контроля доступа' },
  { type: 'webhook', name: 'Webhook', category: 'api', description: 'HTTP-уведомления на ваш сервер' },
  { type: 'rest_api', name: 'REST API', category: 'api', description: 'Полный доступ через API' },
  { type: 'mqtt', name: 'MQTT', category: 'api', description: 'IoT-протокол для устройств' },
  { type: 'modbus', name: 'Modbus', category: 'api', description: 'Промышленный протокол' },
];

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_integrations');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  // Get stored integrations
  const stored = await prisma.integration.findMany({
    where: { organizationId: orgId },
  });

  const storedMap = new Map(stored.map((i) => [i.type, i]));

  // Merge with defaults
  const integrations = DEFAULT_INTEGRATIONS.map((def) => {
    const existing = storedMap.get(def.type);
    return {
      id: existing?.id || def.type,
      type: def.type,
      name: def.name,
      category: def.category,
      description: def.description,
      enabled: existing?.enabled || false,
      config: existing ? JSON.parse(existing.config) : {},
    };
  });

  return NextResponse.json(integrations);
}

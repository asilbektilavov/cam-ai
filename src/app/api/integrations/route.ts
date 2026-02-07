import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';

// Default integrations template
const DEFAULT_INTEGRATIONS = [
  { type: 'telegram', name: 'Telegram', category: 'notifications', description: 'Уведомления через Telegram-бот' },
  { type: 'slack', name: 'Slack', category: 'notifications', description: 'Алерты в Slack-каналы' },
  { type: 'email', name: 'Email SMTP', category: 'notifications', description: 'Уведомления на email' },
  { type: 'sms', name: 'SMS', category: 'notifications', description: 'SMS-уведомления через Eskiz' },
  { type: 'webhook', name: 'Webhook', category: 'api', description: 'HTTP-уведомления на ваш сервер' },
];

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

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

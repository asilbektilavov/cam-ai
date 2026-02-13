import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
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

  const { type } = await params;
  const orgId = session.user.organizationId;
  const body = await request.json();

  const { enabled, config } = body;

  const integration = await prisma.integration.upsert({
    where: {
      organizationId_type: { organizationId: orgId, type },
    },
    update: {
      enabled: enabled ?? false,
      config: config ? JSON.stringify(config) : '{}',
    },
    create: {
      organizationId: orgId,
      type,
      name: body.name || type,
      enabled: enabled ?? false,
      config: config ? JSON.stringify(config) : '{}',
    },
  });

  return NextResponse.json({
    id: integration.id,
    type: integration.type,
    enabled: integration.enabled,
    config: JSON.parse(integration.config),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
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

  const { type } = await params;
  const orgId = session.user.organizationId;

  // Test connection based on type
  const body = await request.json();
  const config = body.config || {};

  try {
    switch (type) {
      case 'telegram': {
        const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return badRequest('Bot Token обязателен');
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = await res.json();
        if (!data.ok) return badRequest('Неверный Bot Token');

        // Send test message if chatId is available
        const chatId = config.chatId;
        if (chatId) {
          const msgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '✅ Тестовое сообщение от CamAI\n\nУведомления работают корректно.',
            }),
          });
          const msgData = await msgRes.json();
          if (!msgData.ok) return badRequest('Бот валиден, но не удалось отправить сообщение. Убедитесь что вы отправили /start боту.');
        }

        return NextResponse.json({ success: true, botName: data.result.username });
      }
      case 'webhook': {
        if (!config.url) return badRequest('URL обязателен');
        const res = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true, source: 'cam-ai' }),
        });
        return NextResponse.json({ success: res.ok, status: res.status });
      }
      default:
        return NextResponse.json({ success: true, message: 'Тестирование для этого типа пока недоступно' });
    }
  } catch (error) {
    return badRequest(`Ошибка соединения: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

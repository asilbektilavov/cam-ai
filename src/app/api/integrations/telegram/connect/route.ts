import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

function getBotToken(config: Record<string, string>): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || config.botToken || null;
}

export async function POST() {
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

  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'telegram' } },
  });

  const config = integration ? (JSON.parse(integration.config) as Record<string, string>) : {};
  const botToken = getBotToken(config);

  if (!botToken) {
    return badRequest('Telegram бот не настроен.');
  }

  // Poll getUpdates to find /start messages with this org's deep link
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100&timeout=0`);
    const data = await res.json();

    if (!data.ok) {
      return badRequest('Неверный Bot Token');
    }

    const updates = data.result as Array<{
      update_id: number;
      message?: {
        chat: { id: number; first_name?: string; title?: string };
        text?: string;
        date: number;
      };
    }>;

    // Match deep link: /start ORG_ID (Telegram sends payload after /start)
    const orgStartMessages = updates
      .filter((u) => u.message?.text === `/start ${orgId}`)
      .sort((a, b) => (b.message?.date || 0) - (a.message?.date || 0));

    // Fallback: if no deep link match, try plain /start (for backward compat)
    const startMessages = orgStartMessages.length > 0
      ? orgStartMessages
      : updates
          .filter((u) => u.message?.text === '/start')
          .sort((a, b) => (b.message?.date || 0) - (a.message?.date || 0));

    if (startMessages.length === 0) {
      return badRequest('Не найдено сообщение /start. Откройте бота в Telegram и отправьте /start.');
    }

    const latestStart = startMessages[0];
    const chatId = String(latestStart.message!.chat.id);
    const chatName = latestStart.message!.chat.title || latestStart.message!.chat.first_name || '';

    // Save chatId to integration config
    const newConfig = { ...config, chatId, chatName };

    await prisma.integration.upsert({
      where: { organizationId_type: { organizationId: orgId, type: 'telegram' } },
      update: {
        enabled: true,
        config: JSON.stringify(newConfig),
      },
      create: {
        organizationId: orgId,
        type: 'telegram',
        name: 'Telegram',
        enabled: true,
        config: JSON.stringify(newConfig),
      },
    });

    // Send confirmation message to the chat
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `✅ CamAI подключён!\n\nВы будете получать уведомления о событиях с камер видеонаблюдения.`,
      }),
    });

    return NextResponse.json({ success: true, chatId, chatName });
  } catch (error) {
    return badRequest(`Ошибка подключения: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

export async function DELETE() {
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

  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'telegram' } },
  });

  if (!integration) {
    return NextResponse.json({ success: true });
  }

  const config = JSON.parse(integration.config) as Record<string, string>;
  delete config.chatId;
  delete config.chatName;

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      enabled: false,
      config: JSON.stringify(config),
    },
  });

  return NextResponse.json({ success: true });
}

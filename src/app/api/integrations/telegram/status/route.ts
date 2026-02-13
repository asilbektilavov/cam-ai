import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { checkPermission, RBACError } from '@/lib/rbac';

function getBotToken(config: Record<string, string>): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || config.botToken || null;
}

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

  const integration = await prisma.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: 'telegram' } },
  });

  const config = integration ? (JSON.parse(integration.config) as Record<string, string>) : {};
  const botToken = getBotToken(config);

  if (!botToken) {
    return NextResponse.json({
      configured: false,
      botUsername: null,
      connected: false,
      chatId: null,
      orgId,
      branches: [],
    });
  }

  // Get bot username
  let botUsername: string | null = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await res.json();
    if (data.ok) {
      botUsername = data.result.username;
    }
  } catch {
    // Bot token might be invalid
  }

  // Get branches with notification settings
  const branches = await prisma.branch.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const notifyBranches = config.notifyBranches
    ? (JSON.parse(config.notifyBranches) as string[])
    : null;

  const branchesWithNotify = branches.map((b) => ({
    id: b.id,
    name: b.name,
    notifyEnabled: notifyBranches === null ? true : notifyBranches.includes(b.id),
  }));

  return NextResponse.json({
    configured: true,
    botUsername,
    connected: !!config.chatId,
    chatId: config.chatId || null,
    orgId,
    branches: branchesWithNotify,
  });
}

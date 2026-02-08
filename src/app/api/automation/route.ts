import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(_req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_automation');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  try {
    const rules = await prisma.automationRule.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });

    // Parse JSON fields for the client
    const parsed = rules.map((rule) => ({
      ...rule,
      trigger: safeJsonParse(rule.trigger),
      conditions: safeJsonParse(rule.conditions),
      actions: safeJsonParse(rule.actions),
    }));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[Automation API] Error:', err);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_automation');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { name, description, trigger, conditions, actions, enabled } = body;

  if (!name || !name.trim()) {
    return badRequest('Название обязательно');
  }

  if (!trigger) {
    return badRequest('Триггер обязателен');
  }

  if (!actions || (Array.isArray(actions) && actions.length === 0)) {
    return badRequest('Необходимо указать хотя бы одно действие');
  }

  const rule = await prisma.automationRule.create({
    data: {
      organizationId: orgId,
      name: name.trim(),
      description: description?.trim() || null,
      trigger: typeof trigger === 'string' ? trigger : JSON.stringify(trigger),
      conditions: typeof conditions === 'string' ? conditions : JSON.stringify(conditions || []),
      actions: typeof actions === 'string' ? actions : JSON.stringify(actions),
      enabled: enabled ?? true,
    },
  });

  return NextResponse.json({
    ...rule,
    trigger: safeJsonParse(rule.trigger),
    conditions: safeJsonParse(rule.conditions),
    actions: safeJsonParse(rule.actions),
  }, { status: 201 });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

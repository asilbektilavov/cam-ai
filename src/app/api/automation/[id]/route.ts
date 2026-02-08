import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, notFound, badRequest } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const rule = await prisma.automationRule.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!rule) return notFound('Правило не найдено');

  return NextResponse.json({
    ...rule,
    trigger: safeJsonParse(rule.trigger),
    conditions: safeJsonParse(rule.conditions),
    actions: safeJsonParse(rule.actions),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.automationRule.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Правило не найдено');

  const body = await req.json();
  const { name, description, trigger, conditions, actions, enabled } = body;

  const data: Record<string, unknown> = {};

  if (name !== undefined) {
    if (!name.trim()) return badRequest('Название обязательно');
    data.name = name.trim();
  }
  if (description !== undefined) {
    data.description = description?.trim() || null;
  }
  if (trigger !== undefined) {
    data.trigger = typeof trigger === 'string' ? trigger : JSON.stringify(trigger);
  }
  if (conditions !== undefined) {
    data.conditions = typeof conditions === 'string' ? conditions : JSON.stringify(conditions);
  }
  if (actions !== undefined) {
    data.actions = typeof actions === 'string' ? actions : JSON.stringify(actions);
  }
  if (enabled !== undefined) {
    data.enabled = enabled;
  }

  const rule = await prisma.automationRule.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    ...rule,
    trigger: safeJsonParse(rule.trigger),
    conditions: safeJsonParse(rule.conditions),
    actions: safeJsonParse(rule.actions),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const orgId = session.user.organizationId;

  const existing = await prisma.automationRule.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return notFound('Правило не найдено');

  await prisma.automationRule.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

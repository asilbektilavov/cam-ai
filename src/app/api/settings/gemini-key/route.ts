import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { checkPermission, RBACError } from '@/lib/rbac';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { geminiApiKey: true },
  });

  const hasOrgKey = !!org?.geminiApiKey;
  const hasEnvKey = !!process.env.GEMINI_API_KEY;

  return NextResponse.json({
    hasOrgKey,
    hasEnvKey,
    maskedKey: hasOrgKey
      ? org.geminiApiKey!.slice(0, 8) + '...' + org.geminiApiKey!.slice(-4)
      : null,
    source: hasOrgKey ? 'organization' : hasEnvKey ? 'environment' : 'none',
  });
}

export async function PUT(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { apiKey } = body;

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return NextResponse.json(
      { error: 'Введите корректный API ключ' },
      { status: 400 }
    );
  }

  const trimmedKey = apiKey.trim();

  // Validate key by making a test call
  try {
    const genAI = new GoogleGenerativeAI(trimmedKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    await model.generateContent('Say "ok" in one word');
  } catch {
    return NextResponse.json(
      { error: 'Недействительный API ключ. Проверьте ключ и попробуйте снова.' },
      { status: 400 }
    );
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { geminiApiKey: trimmedKey },
  });

  return NextResponse.json({
    success: true,
    maskedKey: trimmedKey.slice(0, 8) + '...' + trimmedKey.slice(-4),
  });
}

export async function DELETE() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'manage_settings');
  } catch (e: unknown) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;

  await prisma.organization.update({
    where: { id: orgId },
    data: { geminiApiKey: null },
  });

  return NextResponse.json({ success: true });
}

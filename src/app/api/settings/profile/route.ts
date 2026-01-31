import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true },
  });

  if (!user) return unauthorized();

  return NextResponse.json({
    name: user.name,
    email: user.email,
    role: user.role,
    company: user.organization.name,
  });
}

export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await request.json();
  const { name, email, company } = body;

  if (!name || !email) return badRequest('Имя и email обязательны');

  // Check email uniqueness if changed
  if (email !== session.user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return badRequest('Этот email уже используется');
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name, email },
  });

  if (company) {
    await prisma.organization.update({
      where: { id: session.user.organizationId },
      data: { name: company },
    });
  }

  return NextResponse.json({ success: true });
}

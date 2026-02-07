import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

export async function POST(request: Request) {
  const body = await request.json();
  const { token, name, password } = body;

  if (!token || !name || !password) {
    return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Минимум 8 символов' }, { status: 400 });
  }

  if (!/[a-zA-Zа-яА-Я]/.test(password) || !/[0-9]/.test(password)) {
    return NextResponse.json({ error: 'Пароль должен содержать буквы и цифры' }, { status: 400 });
  }

  const invite = await prisma.teamInvite.findUnique({ where: { token } });

  if (!invite) {
    return NextResponse.json({ error: 'Недействительное приглашение' }, { status: 400 });
  }

  if (invite.acceptedAt) {
    return NextResponse.json({ error: 'Приглашение уже использовано' }, { status: 400 });
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Приглашение истекло' }, { status: 400 });
  }

  // Check email not already registered
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) {
    return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invite.email,
        name,
        passwordHash,
        role: invite.role,
        organizationId: invite.organizationId,
      },
    });

    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    return user;
  });

  logAudit({
    organizationId: invite.organizationId,
    userId: result.id,
    action: 'user.joined',
    entityType: 'user',
    entityId: result.id,
    details: { email: invite.email, role: invite.role },
  });

  return NextResponse.json({ success: true });
}

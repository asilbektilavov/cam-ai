import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  const body = await request.json();
  const { token, password } = body;

  if (!token || !password) {
    return NextResponse.json({ error: 'Токен и пароль обязательны' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Пароль должен содержать минимум 8 символов' },
      { status: 400 }
    );
  }

  if (!/[a-zA-Zа-яА-Я]/.test(password) || !/[0-9]/.test(password)) {
    return NextResponse.json(
      { error: 'Пароль должен содержать буквы и цифры' },
      { status: 400 }
    );
  }

  const resetRecord = await prisma.passwordReset.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetRecord) {
    return NextResponse.json({ error: 'Недействительная ссылка для сброса' }, { status: 400 });
  }

  if (resetRecord.usedAt) {
    return NextResponse.json({ error: 'Ссылка уже была использована' }, { status: 400 });
  }

  if (resetRecord.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Ссылка истекла. Запросите новую.' }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash: hash },
    }),
    prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ success: true, message: 'Пароль успешно изменён' });
}

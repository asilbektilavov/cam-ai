import { NextResponse } from 'next/server';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword) return badRequest('Введите текущий пароль');
  if (!newPassword || newPassword.length < 8) {
    return badRequest('Пароль должен содержать минимум 8 символов');
  }
  if (!/[a-zA-Zа-яА-Я]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return badRequest('Пароль должен содержать буквы и цифры');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) return unauthorized();

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) return badRequest('Неверный текущий пароль');

  const hash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: hash },
  });

  return NextResponse.json({ success: true });
}

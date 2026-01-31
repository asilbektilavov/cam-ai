import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { registerRateLimiter, getClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rl = registerRateLimiter.check(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Слишком много попыток. Повторите через ${rl.retryAfterSeconds} сек.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { name, email, password, company } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Имя, email и пароль обязательны' },
        { status: 400 }
      );
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

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const slug = (company || name)
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: company || name,
          slug,
        },
      });

      await tx.branch.create({
        data: {
          name: 'Главный офис',
          organizationId: org.id,
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: 'admin',
          organizationId: org.id,
        },
      });

      return { user, org };
    });

    return NextResponse.json({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      organizationId: result.org.id,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Ошибка регистрации' },
      { status: 500 }
    );
  }
}

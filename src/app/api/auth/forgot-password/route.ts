import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  const body = await request.json();
  const { email } = body;

  if (!email) {
    return NextResponse.json({ error: 'Email обязателен' }, { status: 400 });
  }

  // Always return success to prevent email enumeration
  const successResponse = NextResponse.json({
    message: 'Если аккаунт существует, письмо с инструкциями отправлено',
  });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return successResponse;

  // Invalidate previous tokens
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Create new token (valid for 1 hour)
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  // Send email if SMTP is configured
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
      });

      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || smtpUser,
        to: email,
        subject: '[CamAI] Сброс пароля',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2>Сброс пароля CamAI</h2>
            <p>Вы запросили сброс пароля. Нажмите кнопку ниже:</p>
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">
              Сбросить пароль
            </a>
            <p style="color: #666; font-size: 14px;">Ссылка действительна 1 час.</p>
            <p style="color: #999; font-size: 12px;">Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('[ForgotPassword] Email send error:', err);
    }
  } else {
    console.log(`[ForgotPassword] SMTP not configured. Reset token for ${email}: ${token}`);
  }

  return successResponse;
}

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized, badRequest } from '@/lib/api-utils';
import { requireRole } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';

const VALID_ROLES = ['admin', 'operator', 'viewer'];

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const roleErr = requireRole(session, 'admin');
  if (roleErr) return roleErr;

  const orgId = session.user.organizationId;

  const users = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const invites = await prisma.teamInvite.findMany({
    where: {
      organizationId: orgId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ members: users, invites });
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const roleErr = requireRole(session, 'admin');
  if (roleErr) return roleErr;

  const orgId = session.user.organizationId;
  const body = await request.json();
  const { email, role } = body;

  if (!email) return badRequest('Email обязателен');
  if (role && !VALID_ROLES.includes(role)) return badRequest('Недопустимая роль');

  const inviteRole = role || 'viewer';

  // Check plan limit
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { plan: true, _count: { select: { users: true } } },
  });
  const maxUsers = org?.plan?.maxUsers ?? 1;
  const pendingInvites = await prisma.teamInvite.count({
    where: { organizationId: orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (org && (org._count.users + pendingInvites) >= maxUsers) {
    return NextResponse.json(
      { error: `Лимит тарифа: максимум ${maxUsers} пользователей. Обновите тариф.` },
      { status: 403 }
    );
  }

  // Check if already a member
  const existingUser = await prisma.user.findFirst({
    where: { email, organizationId: orgId },
  });
  if (existingUser) return badRequest('Пользователь уже в команде');

  // Check if already invited
  const existingInvite = await prisma.teamInvite.findFirst({
    where: { email, organizationId: orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (existingInvite) return badRequest('Приглашение уже отправлено');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await prisma.teamInvite.create({
    data: {
      organizationId: orgId,
      email,
      role: inviteRole,
      token,
      expiresAt,
      invitedBy: session.user.id,
    },
  });

  // Send invite email if SMTP configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const inviteUrl = `${baseUrl}/invite?token=${token}`;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: `Приглашение в ${org?.name || 'CamAI'}`,
        html: `
          <h2>Вас пригласили в команду ${org?.name || 'CamAI'}</h2>
          <p>Роль: <strong>${inviteRole}</strong></p>
          <p>Приглашение действительно 7 дней.</p>
          <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;">Принять приглашение</a></p>
          <p style="color:#666;font-size:12px;">Или перейдите по ссылке: ${inviteUrl}</p>
        `,
      });
    } catch (err) {
      console.error('[Team] Email send error:', err);
    }
  } else {
    console.log(`[Team] Invite token for ${email}: ${token}`);
  }

  logAudit({
    organizationId: orgId,
    userId: session.user.id,
    action: 'user.invite',
    entityType: 'user',
    details: { email, role: inviteRole },
  });

  return NextResponse.json(invite, { status: 201 });
}

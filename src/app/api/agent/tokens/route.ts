import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

function generateToken(): string {
  return 'cam_' + crypto.randomBytes(24).toString('hex');
}

// GET /api/agent/tokens — list agent tokens for current org
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as { organizationId: string };
  const tokens = await prisma.agentToken.findMany({
    where: { organizationId: user.organizationId },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
          lastSeenAt: true,
          version: true,
          ipAddress: true,
          agentCameras: { select: { id: true, name: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(tokens);
}

// POST /api/agent/tokens — create new agent token
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as { organizationId: string };
  const { name } = await request.json().catch(() => ({ name: 'Agent' }));

  const token = generateToken();

  const agentToken = await prisma.agentToken.create({
    data: {
      organizationId: user.organizationId,
      token,
      name: name || 'Agent',
    },
  });

  return NextResponse.json({
    id: agentToken.id,
    token: agentToken.token,
    name: agentToken.name,
    createdAt: agentToken.createdAt,
  });
}

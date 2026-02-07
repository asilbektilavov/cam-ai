import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession, unauthorized } from '@/lib/api-utils';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { checkPermission, RBACError } from '@/lib/rbac';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  try {
    checkPermission(session, 'view_events');
  } catch (e: any) {
    if (e instanceof RBACError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const orgId = session.user.organizationId;
  const { message, cameraId, date } = await req.json();

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build event filter
  const eventWhere: Record<string, unknown> = {
    organizationId: orgId,
  };
  if (cameraId) {
    eventWhere.cameraId = cameraId;
  }
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    eventWhere.timestamp = { gte: start, lt: end };
  }

  // Fetch context data in parallel
  const [events, cameras] = await Promise.all([
    prisma.event.findMany({
      where: eventWhere,
      include: { camera: { select: { name: true, location: true } } },
      orderBy: { timestamp: 'desc' },
      take: 100,
    }),
    prisma.camera.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, location: true, status: true },
    }),
  ]);

  // Build camera list for context
  const cameraList = cameras
    .map((c) => `- ${c.name} (${c.location}) — статус: ${c.status}`)
    .join('\n');

  // Build events list for context
  const eventsList = events
    .map((e) => {
      const ts = new Date(e.timestamp).toLocaleString('ru-RU', {
        timeZone: 'Asia/Tashkent',
      });
      const cam = e.camera ? `${e.camera.name} (${e.camera.location})` : 'Неизвестная камера';
      return `- [${ts}] ${cam} | ${e.type} (${e.severity}): ${e.description}`;
    })
    .join('\n');

  const now = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
  });

  const systemPrompt = `Ты — ИИ-ассистент системы видеонаблюдения CamAI. Отвечай на русском языке.

У пользователя есть следующие камеры:
${cameraList || 'Камеры не найдены.'}

Последние события:
${eventsList || 'Событий не найдено.'}

Текущая дата и время: ${now}

Отвечай кратко и по существу. Если спрашивают о конкретном времени или камере, ищи в предоставленных данных.`;

  try {
    const result = await model.generateContentStream({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + '\n\nВопрос пользователя: ' + message }] },
      ],
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Gemini API error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to generate response' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

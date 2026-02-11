import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { getGeminiApiKey } from '@/lib/gemini-key';

const SUMMARY_PROMPT = `You are a security camera AI analyst. Based on the following chronological sequence of frame descriptions from a surveillance camera session, write a concise summary in Russian.

The summary should:
1. Describe what happened during the session chronologically
2. Note the number of people observed
3. Highlight any alerts or unusual events
4. Be 2-5 sentences long

Frame descriptions (chronological order):
`;

export async function generateSessionSummary(
  sessionId: string,
  organizationId?: string
): Promise<void> {
  try {
    const session = await prisma.analysisSession.findUnique({
      where: { id: sessionId },
      include: {
        frames: {
          orderBy: { capturedAt: 'asc' },
          select: { description: true, peopleCount: true, capturedAt: true },
        },
        camera: { select: { organizationId: true } },
      },
    });

    if (!session || session.frames.length === 0) return;

    const orgId = organizationId || session.camera.organizationId;
    const apiKey = await getGeminiApiKey(orgId);
    if (!apiKey) {
      console.warn('[AI] No Gemini API key available, skipping summary');
      return;
    }

    const frameDescriptions = session.frames
      .filter((f) => f.description)
      .map(
        (f, i) =>
          `${i + 1}. [${f.capturedAt.toISOString()}] ${f.description} (людей: ${f.peopleCount ?? '?'})`
      )
      .join('\n');

    if (!frameDescriptions) {
      await prisma.analysisSession.update({
        where: { id: sessionId },
        data: { summary: 'Анализ кадров не был выполнен.' },
      });
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(
      SUMMARY_PROMPT + frameDescriptions
    );
    const summary = result.response.text();

    await prisma.analysisSession.update({
      where: { id: sessionId },
      data: { summary },
    });

    console.log(`[AI] Summary generated for session ${sessionId}`);
  } catch (error) {
    console.error(`[AI] Summary failed for session ${sessionId}:`, error);
  }
}

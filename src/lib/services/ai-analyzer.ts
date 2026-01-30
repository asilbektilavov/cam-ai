import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile } from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { getFrameAbsolutePath } from './frame-storage';
import { appEvents, CameraEvent } from './event-emitter';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const ANALYSIS_PROMPT = `You are a security camera AI analyst. Analyze this surveillance camera frame and respond ONLY with valid JSON (no markdown, no code blocks).

JSON format:
{
  "description": "Brief description of what's happening in the scene (in Russian)",
  "peopleCount": 0,
  "objects": ["list", "of", "notable", "objects"],
  "alerts": []
}

For "alerts", include objects with format: {"type": "alert_type", "severity": "info|warning|critical", "message": "description in Russian"}

Alert types: "intrusion" (unauthorized access), "crowd" (too many people), "abandoned_object", "unusual_behavior", "safety_hazard"

Only include alerts if something genuinely concerning is visible. Be concise.`;

interface AnalysisResult {
  description: string;
  peopleCount: number;
  objects: string[];
  alerts: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
}

export async function analyzeFrame(
  frameId: string,
  framePath: string,
  cameraId: string,
  organizationId: string,
  sessionId: string
): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[AI] GEMINI_API_KEY not set, skipping analysis');
    return;
  }

  try {
    const absolutePath = getFrameAbsolutePath(framePath);
    const imageBuffer = await readFile(absolutePath);
    const base64Image = imageBuffer.toString('base64');

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent([
      ANALYSIS_PROMPT,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      },
    ]);

    const responseText = result.response.text();

    // Parse JSON from response (handle potential markdown code blocks)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const analysis: AnalysisResult = JSON.parse(jsonStr);

    // Update the frame record
    await prisma.analysisFrame.update({
      where: { id: frameId },
      data: {
        aiResponse: responseText,
        description: analysis.description,
        peopleCount: analysis.peopleCount,
        objects: JSON.stringify(analysis.objects),
      },
    });

    // Create events for any alerts
    for (const alert of analysis.alerts) {
      await prisma.event.create({
        data: {
          cameraId,
          organizationId,
          type: alert.type,
          severity: alert.severity,
          description: alert.message,
          sessionId,
        },
      });

      const event: CameraEvent = {
        type: 'alert',
        cameraId,
        organizationId,
        data: {
          alertType: alert.type,
          severity: alert.severity,
          message: alert.message,
          sessionId,
        },
      };
      appEvents.emit('camera-event', event);
    }

    // Emit frame analyzed event
    const event: CameraEvent = {
      type: 'frame_analyzed',
      cameraId,
      organizationId,
      data: {
        frameId,
        description: analysis.description,
        peopleCount: analysis.peopleCount,
        sessionId,
      },
    };
    appEvents.emit('camera-event', event);
  } catch (error) {
    console.error(`[AI] Analysis failed for frame ${frameId}:`, error);
  }
}

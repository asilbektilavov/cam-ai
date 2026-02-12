import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile } from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { getFrameAbsolutePath } from './frame-storage';
import { appEvents, CameraEvent } from './event-emitter';
import { smartFeaturesEngine } from './smart-features-engine';
import { heatmapGenerator } from './heatmap-generator';
import { peopleCounter } from './people-counter';
import { yoloDetector, YoloDetection } from './yolo-detector';
import { getGeminiApiKey } from '@/lib/gemini-key';

// Fallback instance for env-only key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function getGenAI(orgId: string) {
  const key = await getGeminiApiKey(orgId);
  if (!key) return null;
  if (key === process.env.GEMINI_API_KEY) return genAI;
  return new GoogleGenerativeAI(key);
}

const BASE_PROMPT = `You are a security camera AI analyst. Analyze this surveillance camera frame and respond ONLY with valid JSON (no markdown, no code blocks).

JSON format:
{
  "description": "Brief description of what's happening in the scene (in Russian)",
  "peopleCount": 0,
  "objects": ["list", "of", "notable", "objects"],
  "alerts": []
}

For "alerts", include objects with format: {"type": "alert_type", "severity": "info|warning|critical", "message": "description in Russian"}

Alert types: "intrusion" (unauthorized access), "crowd" (too many people), "abandoned_object", "unusual_behavior", "safety_hazard", "fire", "smoke", "ppe_violation", "tamper", "line_crossing"

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
  // Smart feature fields
  queueLength?: number;
  loiteringDetected?: boolean;
  loiteringDetails?: string;
  staffCount?: number;
  // Advanced detection fields
  fireDetected?: boolean;
  smokeDetected?: boolean;
  ppeViolations?: string[];
  licensePlates?: string[];
  peoplePositions?: Array<{ x: number; y: number }>; // normalized 0-1 coords for heatmap
  lineCrossings?: Array<{ lineId: string; direction: string; count: number }>;
  // New Macroscope-parity fields
  abandonedObjectDetected?: boolean;
  abandonedObjectDetails?: string;
  fallDetected?: boolean;
  tamperDetected?: boolean;
}

type AnalysisMode = 'yolo_only' | 'yolo_gemini_events' | 'yolo_gemini_always';

async function getAnalysisMode(organizationId: string): Promise<AnalysisMode> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { analysisMode: true },
    });
    return (org?.analysisMode as AnalysisMode) || 'yolo_gemini_events';
  } catch {
    return 'yolo_gemini_events';
  }
}

function shouldTriggerGemini(
  mode: AnalysisMode,
  detections: YoloDetection[]
): boolean {
  if (mode === 'yolo_only') return false;
  if (mode === 'yolo_gemini_always') return true;

  // yolo_gemini_events: trigger Gemini only on anomalies
  const personCount = detections.filter((d) => d.type === 'person').length;
  if (personCount > 10) return true; // crowd

  // Unusual objects (not typical person/car)
  const unusualTypes = detections.filter(
    (d) => !['person', 'car', 'truck', 'bus', 'bicycle', 'motorcycle'].includes(d.type)
  );
  if (unusualTypes.length > 0) return true;

  // High-confidence detections of animals (unusual for surveillance)
  const animals = detections.filter(
    (d) => ['cat', 'dog'].includes(d.type) && d.confidence > 0.6
  );
  if (animals.length > 0) return true;

  return false;
}

async function buildPrompt(cameraId: string): Promise<string> {
  const features = await smartFeaturesEngine.getActiveFeatures(cameraId);
  if (features.length === 0) return BASE_PROMPT;

  let prompt = BASE_PROMPT;
  const extraFields: string[] = [];

  for (const feature of features) {
    switch (feature.featureType) {
      case 'queue_monitor':
        prompt += `\n\nQUEUE MONITORING: This camera monitors a checkout/service area. Count the exact number of people standing in a queue or waiting line. Report this as "queueLength" in your JSON response. If no queue is visible, set to 0.`;
        extraFields.push('"queueLength": <number of people in queue>');
        break;

      case 'loitering_detection':
        prompt += `\n\nLOITERING DETECTION: Watch for people who appear to be lingering, standing idle, or staying in one spot without clear purpose for an extended time. If someone appears to be loitering, set "loiteringDetected" to true and describe the behavior in "loiteringDetails" (in Russian).`;
        extraFields.push('"loiteringDetected": <true/false>');
        extraFields.push('"loiteringDetails": "<description if detected, in Russian>"');
        break;

      case 'workstation_monitor':
        prompt += `\n\nWORKSTATION MONITORING: This camera monitors a workstation, counter, or desk that must be staffed. Count the number of staff/workers actively present at the station (not customers/visitors). Report as "staffCount".`;
        extraFields.push('"staffCount": <number of staff at the workstation>');
        break;

      case 'fire_smoke_detection':
        prompt += `\n\nFIRE & SMOKE DETECTION: Carefully check for any signs of fire, flames, or smoke in the frame. If fire is detected, set "fireDetected" to true. If smoke is detected, set "smokeDetected" to true. Include a CRITICAL alert for any fire/smoke.`;
        extraFields.push('"fireDetected": <true/false>');
        extraFields.push('"smokeDetected": <true/false>');
        break;

      case 'ppe_detection':
        prompt += `\n\nPPE/UNIFORM DETECTION: Check if workers/staff are wearing required personal protective equipment (hard hats, safety vests, gloves, masks, etc.). List any violations as "ppeViolations" array with descriptions in Russian (e.g. "Отсутствует каска", "Нет защитного жилета").`;
        extraFields.push('"ppeViolations": ["list of violations in Russian"]');
        break;

      case 'lpr_detection':
        prompt += `\n\nLICENSE PLATE RECOGNITION: Identify any vehicle license plates visible in the frame. Read the plate numbers and report them as "licensePlates" array. Format: readable characters/numbers from the plate.`;
        extraFields.push('"licensePlates": ["ABC123", ...]');
        break;

      case 'heatmap_tracking':
        prompt += `\n\nPEOPLE POSITION TRACKING: For heatmap generation, estimate the position of each person visible in the frame. Report as "peoplePositions" array of {x, y} coordinates normalized to 0-1 range (0,0 = top-left, 1,1 = bottom-right).`;
        extraFields.push('"peoplePositions": [{"x": 0.5, "y": 0.5}, ...]');
        break;

      case 'line_crossing':
        prompt += `\n\nLINE CROSSING: Virtual lines have been defined on this camera. Check if any people or objects appear to be crossing the line positions. Report crossings as "lineCrossings" array.`;
        extraFields.push('"lineCrossings": [{"lineId": "zone_id", "direction": "in|out", "count": 1}]');
        break;

      case 'abandoned_object':
        prompt += `\n\nABANDONED OBJECT DETECTION: Check for objects (bags, packages, boxes, etc.) that appear to be left unattended without a person nearby. Set "abandonedObjectDetected" to true if found and describe in "abandonedObjectDetails" (in Russian).`;
        extraFields.push('"abandonedObjectDetected": <true/false>');
        extraFields.push('"abandonedObjectDetails": "<description if detected, in Russian>"');
        break;

      case 'fall_detection':
        prompt += `\n\nFALL DETECTION: Check if any person appears to have fallen down or is lying on the ground in an unusual position. Set "fallDetected" to true if found. This is critical for safety.`;
        extraFields.push('"fallDetected": <true/false>');
        break;

      case 'tamper_detection':
        prompt += `\n\nTAMPER DETECTION: Check if the camera view appears to be obstructed, covered, defocused, or pointed at an unusual angle compared to a normal surveillance view. Set "tamperDetected" to true if the camera appears to be sabotaged.`;
        extraFields.push('"tamperDetected": <true/false>');
        break;
    }
  }

  if (extraFields.length > 0) {
    prompt += `\n\nIMPORTANT: Include these additional fields in your JSON response:\n${extraFields.join('\n')}`;
  }

  return prompt;
}

export async function analyzeFrame(
  frameId: string,
  framePath: string,
  cameraId: string,
  organizationId: string,
  branchId: string,
  sessionId: string
): Promise<void> {
  try {
    const t0 = Date.now();
    const absolutePath = getFrameAbsolutePath(framePath);
    const imageBuffer = await readFile(absolutePath);
    const tRead = Date.now();

    // --- YOLO Detection (always runs) ---
    const yoloDetections = await yoloDetector.detect(imageBuffer);
    const tYolo = Date.now();

    console.log(
      `[AI] analyzeFrame ${frameId.slice(0, 8)}: read=${tRead - t0}ms yolo=${tYolo - tRead}ms detections=${yoloDetections.length} (${yoloDetections.map(d => `${d.label} ${Math.round(d.confidence * 100)}%`).join(', ') || 'none'})`
    );

    // Save YOLO detections to frame
    const detectionsJson = yoloDetections.length > 0
      ? JSON.stringify(yoloDetections)
      : null;

    // Count people from YOLO
    const yoloPeopleCount = yoloDetections.filter((d) => d.type === 'person').length;

    // Extract people positions from YOLO detections for heatmap
    const yoloPeoplePositions = yoloDetections
      .filter((d) => d.type === 'person')
      .map((d) => ({
        x: d.bbox.x + d.bbox.w / 2,
        y: d.bbox.y + d.bbox.h / 2,
      }));

    if (yoloPeoplePositions.length > 0) {
      heatmapGenerator.recordPositions(cameraId, yoloPeoplePositions);
    }

    peopleCounter.recordCount(cameraId, yoloPeopleCount);

    // NOTE: frame_analyzed SSE is emitted by camera-monitor.ts emitLiveDetections() only
    // to avoid duplicate bounding-box events on the frontend.
    console.log(`[AI] YOLO: ${yoloDetections.length} detections, total=${Date.now() - t0}ms`);

    // --- Determine if Gemini should run ---
    const mode = await getAnalysisMode(organizationId);
    const runGemini = shouldTriggerGemini(mode, yoloDetections);

    const orgGenAI = await getGenAI(organizationId);

    if (!runGemini || !orgGenAI) {
      // YOLO-only: save detections and people count, no Gemini
      await prisma.analysisFrame.update({
        where: { id: frameId },
        data: {
          detections: detectionsJson,
          peopleCount: yoloPeopleCount,
          objects: yoloDetections.length > 0
            ? JSON.stringify([...new Set(yoloDetections.map((d) => d.label))])
            : null,
        },
      });
      return;
    }

    // --- Gemini Analysis ---
    const base64Image = imageBuffer.toString('base64');
    const prompt = await buildPrompt(cameraId);

    const model = orgGenAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      prompt,
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

    // Update the frame record with both YOLO and Gemini data
    await prisma.analysisFrame.update({
      where: { id: frameId },
      data: {
        aiResponse: responseText,
        description: analysis.description,
        peopleCount: analysis.peopleCount || yoloPeopleCount,
        objects: JSON.stringify(analysis.objects),
        detections: detectionsJson,
      },
    });

    // Record positions for heatmap from Gemini (if available, more precise)
    if (analysis.peoplePositions && analysis.peoplePositions.length > 0) {
      heatmapGenerator.recordPositions(cameraId, analysis.peoplePositions);
    }

    // Create events for any alerts
    for (const alert of analysis.alerts) {
      await prisma.event.create({
        data: {
          cameraId,
          organizationId,
          branchId,
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
        branchId,
        data: {
          alertType: alert.type,
          severity: alert.severity,
          message: alert.message,
          sessionId,
        },
      };
      appEvents.emit('camera-event', event);
    }

    // Evaluate smart features with the analysis results
    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { name: true, location: true },
    });

    if (camera) {
      void smartFeaturesEngine.evaluate(
        cameraId,
        organizationId,
        branchId,
        camera.name,
        camera.location,
        {
          peopleCount: analysis.peopleCount,
          description: analysis.description,
          queueLength: analysis.queueLength,
          loiteringDetected: analysis.loiteringDetected,
          loiteringDetails: analysis.loiteringDetails,
          staffCount: analysis.staffCount,
        }
      );
    }

    // Fire/Smoke detection events
    if (analysis.fireDetected) {
      await prisma.event.create({
        data: { cameraId, organizationId, branchId, type: 'fire', severity: 'critical', description: 'Обнаружен огонь!', sessionId },
      });
      appEvents.emit('camera-event', { type: 'fire_detected', cameraId, organizationId, branchId, data: { sessionId } } as CameraEvent);
    }
    if (analysis.smokeDetected) {
      await prisma.event.create({
        data: { cameraId, organizationId, branchId, type: 'smoke', severity: 'critical', description: 'Обнаружен дым!', sessionId },
      });
      appEvents.emit('camera-event', { type: 'smoke_detected', cameraId, organizationId, branchId, data: { sessionId } } as CameraEvent);
    }

    // PPE violations
    if (analysis.ppeViolations && analysis.ppeViolations.length > 0) {
      await prisma.event.create({
        data: { cameraId, organizationId, branchId, type: 'ppe_violation', severity: 'warning', description: `Нарушения СИЗ: ${analysis.ppeViolations.join(', ')}`, sessionId },
      });
      appEvents.emit('camera-event', { type: 'ppe_violation', cameraId, organizationId, branchId, data: { violations: analysis.ppeViolations, sessionId } } as CameraEvent);
    }

    // Abandoned object (Gemini-based)
    if (analysis.abandonedObjectDetected) {
      await prisma.event.create({
        data: { cameraId, organizationId, branchId, type: 'abandoned_object', severity: 'warning', description: analysis.abandonedObjectDetails || 'Обнаружен оставленный предмет', sessionId },
      });
      appEvents.emit('camera-event', { type: 'abandoned_object', cameraId, organizationId, branchId, data: { details: analysis.abandonedObjectDetails, sessionId } } as CameraEvent);
    }

    // Fall detection (Gemini-based)
    if (analysis.fallDetected) {
      await prisma.event.create({
        data: { cameraId, organizationId, branchId, type: 'fall', severity: 'critical', description: 'Обнаружено падение человека!', sessionId },
      });
      appEvents.emit('camera-event', { type: 'fall_detected', cameraId, organizationId, branchId, data: { sessionId } } as CameraEvent);
    }

    // Tamper detection (Gemini-based)
    if (analysis.tamperDetected) {
      await prisma.event.create({
        data: { cameraId, organizationId, branchId, type: 'tamper', severity: 'critical', description: 'Обнаружен саботаж камеры — обзор заблокирован или изменён', sessionId },
      });
      appEvents.emit('camera-event', { type: 'tamper_detected', cameraId, organizationId, branchId, data: { sessionId } } as CameraEvent);
    }

    // License plate detections
    if (analysis.licensePlates && analysis.licensePlates.length > 0) {
      for (const plateNumber of analysis.licensePlates) {
        const knownPlate = await prisma.licensePlate.findFirst({
          where: { number: plateNumber, organization: { cameras: { some: { id: cameraId } } } },
        });

        await prisma.plateDetection.create({
          data: {
            cameraId,
            number: plateNumber,
            confidence: 0.85,
            licensePlateId: knownPlate?.id || null,
          },
        });

        if (knownPlate?.type === 'blacklist') {
          await prisma.event.create({
            data: { cameraId, organizationId, branchId, type: 'blacklist_plate', severity: 'critical', description: `Обнаружен номер из чёрного списка: ${plateNumber}`, sessionId },
          });
        }

        appEvents.emit('camera-event', { type: 'plate_detected', cameraId, organizationId, branchId, data: { plateNumber, knownPlate: knownPlate?.type, sessionId } } as CameraEvent);
      }
    }
  } catch (error) {
    console.error(`[AI] Analysis failed for frame ${frameId}:`, error);
  }
}

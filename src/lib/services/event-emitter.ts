import { EventEmitter } from 'events';

// Singleton event emitter for cross-service communication and SSE
// Uses `process` as the container — guaranteed single object per Node.js process,
// survives Turbopack HMR module reloads (unlike globalThis which can be scoped per chunk).
class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

const PROCESS_KEY = '__camai_appEvents__';
const proc = process as unknown as Record<string, AppEventEmitter | undefined>;

if (!proc[PROCESS_KEY]) {
  proc[PROCESS_KEY] = new AppEventEmitter();
}

export const appEvents: AppEventEmitter = proc[PROCESS_KEY]!;

// Event types
export interface CameraEvent {
  type:
    | 'motion_detected'
    | 'session_started'
    | 'session_ended'
    | 'frame_analyzed'
    | 'alert'
    | 'smart_alert'
    | 'person_sighting'
    | 'line_crossing'
    | 'queue_alert'
    | 'abandoned_object'
    | 'tamper_detected'
    | 'fire_detected'
    | 'smoke_detected'
    | 'ppe_violation'
    | 'plate_detected'
    | 'fall_detected'
    | 'crowd'
    | 'behavior_alert'
    | 'speed_alert'
    | 'occupancy_update'
    | 'face_detected';
  cameraId: string;
  organizationId: string;
  branchId: string;
  data: Record<string, unknown>;
}

// Smart feature alert
export interface SmartAlert {
  featureType: string;
  cameraId: string;
  cameraName: string;
  cameraLocation: string;
  organizationId: string;
  branchId: string;
  integrationId: string | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  metadata: Record<string, unknown>;
}

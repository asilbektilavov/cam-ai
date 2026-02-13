import { EventEmitter } from 'events';

// Singleton event emitter for cross-service communication and SSE
class AppEventEmitter extends EventEmitter {
  private static instance: AppEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): AppEventEmitter {
    if (!AppEventEmitter.instance) {
      AppEventEmitter.instance = new AppEventEmitter();
    }
    return AppEventEmitter.instance;
  }
}

const globalForAppEvents = globalThis as unknown as {
  appEvents: AppEventEmitter | undefined;
};

export const appEvents =
  globalForAppEvents.appEvents ?? AppEventEmitter.getInstance();

if (process.env.NODE_ENV !== 'production')
  globalForAppEvents.appEvents = appEvents;

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

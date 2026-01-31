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

export const appEvents = AppEventEmitter.getInstance();

// Event types
export interface CameraEvent {
  type: 'motion_detected' | 'session_started' | 'session_ended' | 'frame_analyzed' | 'alert' | 'smart_alert' | 'person_sighting';
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

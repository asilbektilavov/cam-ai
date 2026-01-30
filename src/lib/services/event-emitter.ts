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
  type: 'motion_detected' | 'session_started' | 'session_ended' | 'frame_analyzed' | 'alert';
  cameraId: string;
  organizationId: string;
  data: Record<string, unknown>;
}

export type VenueType = 'retail' | 'restaurant' | 'warehouse' | 'office' | 'bank' | 'parking';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  company?: string;
  createdAt: string;
}

export interface Camera {
  id: string;
  name: string;
  location: string;
  status: 'online' | 'offline' | 'maintenance';
  venueType: VenueType;
  resolution: string;
  fps: number;
  lastActivity: string;
  thumbnail?: string;
  streamUrl?: string;
  isMonitoring?: boolean;
  motionThreshold?: number;
  captureInterval?: number;
}

export interface AnalyticsEvent {
  id: string;
  cameraId: string;
  type: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface VenueConfig {
  type: VenueType;
  label: string;
  description: string;
  icon: string;
  features: AnalyticsFeature[];
  color: string;
}

export interface AnalyticsFeature {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  category: 'detection' | 'counting' | 'tracking' | 'safety' | 'business';
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  connected: boolean;
  category: 'notifications' | 'crm' | 'access' | 'api';
  config?: Record<string, string>;
}

export interface DashboardStats {
  totalCameras: number;
  onlineCameras: number;
  totalEvents: number;
  criticalEvents: number;
  peopleDetected: number;
  avgOccupancy: number;
}

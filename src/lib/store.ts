import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, VenueType, Camera, AnalyticsEvent, Integration } from './types';

interface AppState {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => boolean;
  register: (name: string, email: string, password: string) => boolean;
  logout: () => void;

  // Venue
  selectedVenue: VenueType | null;
  setSelectedVenue: (venue: VenueType) => void;

  // Cameras
  cameras: Camera[];
  addCamera: (camera: Omit<Camera, 'id'>) => void;
  removeCamera: (id: string) => void;
  toggleCameraStatus: (id: string) => void;

  // Events
  events: AnalyticsEvent[];

  // Integrations
  integrations: Integration[];
  toggleIntegration: (id: string) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const mockCameras: Camera[] = [
  {
    id: '1',
    name: 'Камера входа',
    location: 'Главный вход',
    status: 'online',
    venueType: 'retail',
    resolution: '1920x1080',
    fps: 30,
    lastActivity: '2 мин назад',
  },
  {
    id: '2',
    name: 'Камера зала',
    location: 'Торговый зал',
    status: 'online',
    venueType: 'retail',
    resolution: '2560x1440',
    fps: 25,
    lastActivity: '1 мин назад',
  },
  {
    id: '3',
    name: 'Камера кассы',
    location: 'Кассовая зона',
    status: 'online',
    venueType: 'retail',
    resolution: '1920x1080',
    fps: 30,
    lastActivity: 'Сейчас',
  },
  {
    id: '4',
    name: 'Камера склада',
    location: 'Складское помещение',
    status: 'offline',
    venueType: 'warehouse',
    resolution: '1280x720',
    fps: 15,
    lastActivity: '1 час назад',
  },
  {
    id: '5',
    name: 'Камера парковки',
    location: 'Парковка B1',
    status: 'online',
    venueType: 'parking',
    resolution: '1920x1080',
    fps: 20,
    lastActivity: '30 сек назад',
  },
  {
    id: '6',
    name: 'Камера офиса',
    location: 'Опен-спейс',
    status: 'maintenance',
    venueType: 'office',
    resolution: '1920x1080',
    fps: 25,
    lastActivity: '3 часа назад',
  },
];

const mockEvents: AnalyticsEvent[] = [
  {
    id: '1',
    cameraId: '1',
    type: 'motion_detected',
    description: 'Обнаружено движение в нерабочее время',
    severity: 'warning',
    timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
  },
  {
    id: '2',
    cameraId: '3',
    type: 'crowd_detected',
    description: 'Очередь более 5 человек на кассе',
    severity: 'info',
    timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
  },
  {
    id: '3',
    cameraId: '2',
    type: 'suspicious_behavior',
    description: 'Подозрительное поведение в торговом зале',
    severity: 'critical',
    timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
  },
  {
    id: '4',
    cameraId: '5',
    type: 'license_plate',
    description: 'Распознан номер: A777AA 77',
    severity: 'info',
    timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
  },
  {
    id: '5',
    cameraId: '1',
    type: 'face_detected',
    description: 'Обнаружен VIP клиент',
    severity: 'info',
    timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
  },
  {
    id: '6',
    cameraId: '4',
    type: 'camera_offline',
    description: 'Камера склада потеряла соединение',
    severity: 'critical',
    timestamp: new Date(Date.now() - 90 * 60000).toISOString(),
  },
  {
    id: '7',
    cameraId: '2',
    type: 'people_count',
    description: 'В зале 47 посетителей (пиковая нагрузка)',
    severity: 'warning',
    timestamp: new Date(Date.now() - 120 * 60000).toISOString(),
  },
  {
    id: '8',
    cameraId: '6',
    type: 'safety_violation',
    description: 'Сотрудник без защитного снаряжения',
    severity: 'critical',
    timestamp: new Date(Date.now() - 150 * 60000).toISOString(),
  },
];

const mockIntegrations: Integration[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Мгновенные уведомления в Telegram бот',
    icon: 'MessageCircle',
    connected: false,
    category: 'notifications',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Оповещения в каналы Slack',
    icon: 'Hash',
    connected: false,
    category: 'notifications',
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Уведомления на электронную почту',
    icon: 'Mail',
    connected: true,
    category: 'notifications',
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'SMS-оповещения о критических событиях',
    icon: 'Smartphone',
    connected: false,
    category: 'notifications',
  },
  {
    id: 'bitrix24',
    name: 'Битрикс24',
    description: 'Интеграция с CRM Битрикс24',
    icon: 'Building2',
    connected: false,
    category: 'crm',
  },
  {
    id: '1c',
    name: '1С:Предприятие',
    description: 'Синхронизация с системой 1С',
    icon: 'Database',
    connected: false,
    category: 'crm',
  },
  {
    id: 'amo',
    name: 'AmoCRM',
    description: 'Интеграция с AmoCRM',
    icon: 'Users',
    connected: false,
    category: 'crm',
  },
  {
    id: 'access_control',
    name: 'СКУД',
    description: 'Интеграция с системой контроля доступа',
    icon: 'KeyRound',
    connected: false,
    category: 'access',
  },
  {
    id: 'pos',
    name: 'POS-система',
    description: 'Интеграция с кассовыми аппаратами',
    icon: 'CreditCard',
    connected: false,
    category: 'access',
  },
  {
    id: 'webhook',
    name: 'Webhook',
    description: 'Отправка событий через HTTP Webhooks',
    icon: 'Webhook',
    connected: false,
    category: 'api',
  },
  {
    id: 'rest_api',
    name: 'REST API',
    description: 'Полноценный REST API для интеграции',
    icon: 'Code',
    connected: true,
    category: 'api',
  },
  {
    id: 'mqtt',
    name: 'MQTT',
    description: 'IoT протокол для умного дома и устройств',
    icon: 'Radio',
    connected: false,
    category: 'api',
  },
];

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      isAuthenticated: false,
      login: (email: string, _password: string) => {
        const user: User = {
          id: '1',
          email,
          name: email.split('@')[0],
          company: 'CamAI Demo',
          createdAt: new Date().toISOString(),
        };
        set({ user, isAuthenticated: true });
        return true;
      },
      register: (name: string, email: string, _password: string) => {
        const user: User = {
          id: '1',
          email,
          name,
          company: '',
          createdAt: new Date().toISOString(),
        };
        set({ user, isAuthenticated: true });
        return true;
      },
      logout: () => {
        set({ user: null, isAuthenticated: false, selectedVenue: null });
      },

      // Venue
      selectedVenue: null,
      setSelectedVenue: (venue: VenueType) => set({ selectedVenue: venue }),

      // Cameras
      cameras: mockCameras,
      addCamera: (camera) => {
        const newCamera: Camera = { ...camera, id: Date.now().toString() };
        set((state) => ({ cameras: [...state.cameras, newCamera] }));
      },
      removeCamera: (id) => {
        set((state) => ({ cameras: state.cameras.filter((c) => c.id !== id) }));
      },
      toggleCameraStatus: (id) => {
        set((state) => ({
          cameras: state.cameras.map((c) =>
            c.id === id
              ? { ...c, status: c.status === 'online' ? 'offline' : 'online' }
              : c
          ),
        }));
      },

      // Events
      events: mockEvents,

      // Integrations
      integrations: mockIntegrations,
      toggleIntegration: (id) => {
        set((state) => ({
          integrations: state.integrations.map((i) =>
            i.id === id ? { ...i, connected: !i.connected } : i
          ),
        }));
      },

      // Sidebar
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'cam-ai-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        selectedVenue: state.selectedVenue,
      }),
    }
  )
);

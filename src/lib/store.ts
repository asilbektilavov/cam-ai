import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VenueType, Integration } from './types';

interface AppState {
  // Venue
  selectedVenue: VenueType | null;
  setSelectedVenue: (venue: VenueType) => void;

  // Integrations (client-side for MVP)
  integrations: Integration[];
  toggleIntegration: (id: string) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const mockIntegrations: Integration[] = [
  { id: 'telegram', name: 'Telegram', description: 'Мгновенные уведомления в Telegram бот', icon: 'MessageCircle', connected: false, category: 'notifications' },
  { id: 'slack', name: 'Slack', description: 'Оповещения в каналы Slack', icon: 'Hash', connected: false, category: 'notifications' },
  { id: 'email', name: 'Email', description: 'Уведомления на электронную почту', icon: 'Mail', connected: true, category: 'notifications' },
  { id: 'sms', name: 'SMS', description: 'SMS-оповещения о критических событиях', icon: 'Smartphone', connected: false, category: 'notifications' },
  { id: 'bitrix24', name: 'Битрикс24', description: 'Интеграция с CRM Битрикс24', icon: 'Building2', connected: false, category: 'crm' },
  { id: '1c', name: '1С:Предприятие', description: 'Синхронизация с системой 1С', icon: 'Database', connected: false, category: 'crm' },
  { id: 'amo', name: 'AmoCRM', description: 'Интеграция с AmoCRM', icon: 'Users', connected: false, category: 'crm' },
  { id: 'access_control', name: 'СКУД', description: 'Интеграция с системой контроля доступа', icon: 'KeyRound', connected: false, category: 'access' },
  { id: 'pos', name: 'POS-система', description: 'Интеграция с кассовыми аппаратами', icon: 'CreditCard', connected: false, category: 'access' },
  { id: 'webhook', name: 'Webhook', description: 'Отправка событий через HTTP Webhooks', icon: 'Webhook', connected: false, category: 'api' },
  { id: 'rest_api', name: 'REST API', description: 'Полноценный REST API для интеграции', icon: 'Code', connected: true, category: 'api' },
  { id: 'mqtt', name: 'MQTT', description: 'IoT протокол для умного дома и устройств', icon: 'Radio', connected: false, category: 'api' },
];

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Venue
      selectedVenue: null,
      setSelectedVenue: (venue: VenueType) => set({ selectedVenue: venue }),

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
        selectedVenue: state.selectedVenue,
      }),
    }
  )
);

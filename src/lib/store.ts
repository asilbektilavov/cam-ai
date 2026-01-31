import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VenueType } from './types';

interface AppState {
  // Venue
  selectedVenue: VenueType | null;
  setSelectedVenue: (venue: VenueType) => void;

  // Branch
  selectedBranchId: string | null;
  setSelectedBranchId: (id: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Venue
      selectedVenue: null,
      setSelectedVenue: (venue: VenueType) => set({ selectedVenue: venue }),

      // Branch
      selectedBranchId: null,
      setSelectedBranchId: (id) => set({ selectedBranchId: id }),

      // Sidebar
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'cam-ai-storage',
      partialize: (state) => ({
        selectedVenue: state.selectedVenue,
        selectedBranchId: state.selectedBranchId,
      }),
    }
  )
);

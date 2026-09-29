import { create } from 'zustand';

export type SettingsTab = 'personality' | 'about' | 'memory' | 'engine' | 'appearance';

interface UiState {
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  settings: SettingsTab | null;
  paletteOpen: boolean;
  toggleSidebar(): void;
  setMobileSidebar(open: boolean): void;
  openSettings(tab?: SettingsTab): void;
  closeSettings(): void;
  setPalette(open: boolean): void;
}

const SIDEBAR_KEY = 'conch.sidebar';

export const useUi = create<UiState>((set) => ({
  sidebarOpen: typeof localStorage === 'undefined' || localStorage.getItem(SIDEBAR_KEY) !== '0',
  mobileSidebarOpen: false,
  settings: null,
  paletteOpen: false,
  toggleSidebar: () =>
    set((s) => {
      localStorage.setItem(SIDEBAR_KEY, s.sidebarOpen ? '0' : '1');
      return { sidebarOpen: !s.sidebarOpen };
    }),
  setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  openSettings: (tab = 'personality') => set({ settings: tab, paletteOpen: false }),
  closeSettings: () => set({ settings: null }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
}));

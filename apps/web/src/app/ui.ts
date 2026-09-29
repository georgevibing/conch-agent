import type { TurnOptions } from '@conch/protocol';
import { create } from 'zustand';

export type SettingsTab =
  'personality' | 'about' | 'memory' | 'models' | 'commands' | 'engine' | 'appearance';

/** Which composer picker is open (so `/model` and `/mode` can open them). */
export type Picker = 'model' | 'mode' | null;

interface UiState {
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  settings: SettingsTab | null;
  paletteOpen: boolean;
  picker: Picker;
  /** Model/effort/mode chosen for a new chat before its first message. */
  draftOptions: TurnOptions;
  setPicker(picker: Picker): void;
  setDraftOptions(options: TurnOptions): void;
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
  picker: null,
  draftOptions: {},
  setPicker: (picker) => set({ picker }),
  setDraftOptions: (draftOptions) => set({ draftOptions }),
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

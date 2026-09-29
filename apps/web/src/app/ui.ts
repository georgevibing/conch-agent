import type { TurnOptions } from '@conch/protocol';
import { create } from 'zustand';

export type SettingsTab =
  | 'personality'
  | 'about'
  | 'memory'
  | 'models'
  | 'commands'
  | 'usage'
  | 'security'
  | 'providers'
  | 'browser'
  | 'appearance';

/** Which composer picker is open (so `/model` and `/mode` can open them). */
export type Picker = 'model' | 'mode' | null;

/** Find-in-chat, open for one conversation. */
export interface FindState {
  conversationId: string;
  query: string;
  /** Selector of a message to land on (set when arriving from search). */
  target?: string;
  /** Changes whenever the field should re-focus and select. */
  key: number;
}

interface UiState {
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  settings: SettingsTab | null;
  paletteOpen: boolean;
  find: FindState | null;
  /** What find last searched for, so ⌘F reopens where you left off. */
  lastFind?: { conversationId: string; query: string };
  /** The header usage popover (so `/usage` and the composer notice can open it). */
  usageOpen: boolean;
  picker: Picker;
  /** Model/effort/mode chosen for a new chat before its first message. */
  draftOptions: TurnOptions;
  /** Words to put in the open chat's composer (e.g. `/weekly-review ` from ⌘K). */
  composerText: string | null;
  setComposerText(text: string | null): void;
  setPicker(picker: Picker): void;
  setDraftOptions(options: TurnOptions): void;
  toggleSidebar(): void;
  setMobileSidebar(open: boolean): void;
  openSettings(tab?: SettingsTab): void;
  closeSettings(): void;
  setPalette(open: boolean): void;
  openFind(conversationId: string, query?: string, target?: string): void;
  setFindQuery(query: string): void;
  closeFind(): void;
  setUsageOpen(open: boolean): void;
  /** The chat whose browser panel is open, if any. */
  browserFor: string | null;
  /** When you last closed a chat's browser panel: it only opens by itself for newer browsing. */
  browserDismissed: Record<string, number>;
  /** The panel's width in pixels (remembered). */
  browserWidth: number;
  openBrowser(conversationId: string): void;
  closeBrowser(): void;
  setBrowserWidth(width: number): void;
}

const SIDEBAR_KEY = 'conch.sidebar';
const BROWSER_WIDTH_KEY = 'conch.browserWidth';

function storedWidth(): number {
  const value =
    typeof localStorage === 'undefined' ? NaN : Number(localStorage.getItem(BROWSER_WIDTH_KEY));
  return Number.isFinite(value) && value >= 320 ? value : 560;
}

export const useUi = create<UiState>((set) => ({
  sidebarOpen: typeof localStorage === 'undefined' || localStorage.getItem(SIDEBAR_KEY) !== '0',
  mobileSidebarOpen: false,
  settings: null,
  paletteOpen: false,
  find: null,
  usageOpen: false,
  picker: null,
  draftOptions: {},
  composerText: null,
  setComposerText: (composerText) => set({ composerText }),
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
  openFind: (conversationId, query, target) =>
    set((s) => ({
      paletteOpen: false,
      find: {
        conversationId,
        // Re-opening keeps what you last searched for, like every find bar.
        query:
          query ??
          (s.find?.conversationId === conversationId
            ? s.find.query
            : s.lastFind?.conversationId === conversationId
              ? s.lastFind.query
              : ''),
        target,
        key: (s.find?.key ?? 0) + 1,
      },
    })),
  setFindQuery: (query) =>
    set((s) => (s.find ? { find: { ...s.find, query, target: undefined } } : s)),
  closeFind: () =>
    set((s) => ({
      find: null,
      lastFind: s.find
        ? { conversationId: s.find.conversationId, query: s.find.query }
        : s.lastFind,
    })),
  setUsageOpen: (usageOpen) => set({ usageOpen }),
  browserFor: null,
  browserDismissed: {},
  browserWidth: storedWidth(),
  openBrowser: (browserFor) => set({ browserFor, paletteOpen: false }),
  closeBrowser: () =>
    set((s) =>
      s.browserFor
        ? {
            browserFor: null,
            browserDismissed: { ...s.browserDismissed, [s.browserFor]: Date.now() },
          }
        : s,
    ),
  setBrowserWidth: (browserWidth) => {
    try {
      localStorage.setItem(BROWSER_WIDTH_KEY, String(Math.round(browserWidth)));
    } catch {
      // Private windows: the width just isn't remembered.
    }
    set({ browserWidth });
  },
}));

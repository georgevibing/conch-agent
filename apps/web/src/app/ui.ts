import type { TurnOptions } from '@conch/protocol';
import { create } from 'zustand';

export type SettingsTab =
  | 'personality'
  | 'about'
  | 'memory'
  | 'models'
  | 'commands'
  | 'usage'
  | 'health'
  | 'security'
  | 'notifications'
  | 'voice'
  | 'providers'
  | 'browser'
  | 'terminal'
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
  /**
   * Conch is starting itself again (an update, a restore): the page rests
   * until it's back. `reopen`: the settings tab to show again after the reload.
   */
  restarting?: {
    title: string;
    from?: string;
    reopen?: SettingsTab;
    /** Quit on purpose: the page rests until Conch is opened again. */
    stopped?: boolean;
  };
  /** Something to open inside the settings tab (a provider's page), once. */
  settingsFocus?: string;
  paletteOpen: boolean;
  /**
   * Talk mode is open (ADR 0027). `from`: where the answer to what was just
   * said starts in the chat, so a new chat (which opens on its own page)
   * still speaks it.
   */
  talking?: { from?: number };
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
  /** Bumped to open the chat's file picker (⌘K "Attach files"). */
  attachRequest: number;
  requestAttach(): void;
  setPicker(picker: Picker): void;
  setDraftOptions(options: TurnOptions): void;
  toggleSidebar(): void;
  setMobileSidebar(open: boolean): void;
  /** `focus`: open this inside the tab straight away (e.g. a provider, to sign in). */
  openSettings(tab?: SettingsTab, focus?: string): void;
  setRestarting(restarting: UiState['restarting']): void;
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
  /** The terminal drawer is open. */
  terminalOpen: boolean;
  /** Its height in pixels (remembered), and whether it fills the screen. */
  terminalHeight: number;
  terminalMax: boolean;
  /** The terminal in view. */
  terminalActive: string | null;
  /** Text to type into the terminal ("Run in terminal"): never with Enter. */
  terminalPaste: string | null;
  /** Bumped to ask the drawer for a new terminal. */
  terminalNew: number;
  setTerminalOpen(open: boolean): void;
  toggleTerminal(): void;
  setTerminalHeight(height: number): void;
  setTerminalMax(max: boolean): void;
  setTerminalActive(id: string | null): void;
  pasteInTerminal(text: string | null): void;
  newTerminal(): void;
}

const SIDEBAR_KEY = 'conch.sidebar';
const BROWSER_WIDTH_KEY = 'conch.browserWidth';
const TERMINAL_HEIGHT_KEY = 'conch.terminalHeight';

function storedHeight(): number {
  const value =
    typeof localStorage === 'undefined' ? NaN : Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
  return Number.isFinite(value) && value >= 160 ? value : 300;
}

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
  attachRequest: 0,
  requestAttach: () => set((state) => ({ attachRequest: state.attachRequest + 1 })),
  setPicker: (picker) => set({ picker }),
  setDraftOptions: (draftOptions) => set({ draftOptions }),
  toggleSidebar: () =>
    set((s) => {
      localStorage.setItem(SIDEBAR_KEY, s.sidebarOpen ? '0' : '1');
      return { sidebarOpen: !s.sidebarOpen };
    }),
  setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  openSettings: (tab = 'personality', focus) =>
    set({ settings: tab, settingsFocus: focus, paletteOpen: false }),
  // The whole page rests while Conch starts again: nothing stays open over the calm screen.
  setRestarting: (restarting) =>
    set(restarting ? { restarting, settings: null, paletteOpen: false } : { restarting }),
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
  terminalOpen: false,
  terminalHeight: storedHeight(),
  terminalMax: false,
  terminalActive: null,
  terminalPaste: null,
  terminalNew: 0,
  setTerminalOpen: (terminalOpen) => set({ terminalOpen, paletteOpen: false }),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen, paletteOpen: false })),
  setTerminalHeight: (terminalHeight) => {
    try {
      localStorage.setItem(TERMINAL_HEIGHT_KEY, String(Math.round(terminalHeight)));
    } catch {
      // Private windows: the height just isn't remembered.
    }
    set({ terminalHeight });
  },
  setTerminalMax: (terminalMax) => set({ terminalMax }),
  setTerminalActive: (terminalActive) => set({ terminalActive }),
  pasteInTerminal: (terminalPaste) =>
    set(terminalPaste === null ? { terminalPaste } : { terminalPaste, terminalOpen: true }),
  newTerminal: () => set((s) => ({ terminalNew: s.terminalNew + 1, terminalOpen: true })),
  setBrowserWidth: (browserWidth) => {
    try {
      localStorage.setItem(BROWSER_WIDTH_KEY, String(Math.round(browserWidth)));
    } catch {
      // Private windows: the width just isn't remembered.
    }
    set({ browserWidth });
  },
}));

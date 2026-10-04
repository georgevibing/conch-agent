import type { TurnOptions } from '@conch/protocol';
import { create } from 'zustand';

import type { PageOwner } from '../features/conchapps/api';
import { leaveSettings, showSettings, type SettingsMove } from '../features/settings/navigate';
import type { SettingsTab } from '../features/settings/paths';

export type { SettingsTab };

/** Which composer picker is open (so `/model` and `/mode` can open them). */
export type Picker = 'model' | 'mode' | null;

/** A Conch app's page open beside a chat (ADR 0061): a draft's while it's being made, or an app's. */
export interface AppPageOpen {
  conversationId: string;
  owner: PageOwner;
  pageId: string;
}

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
  /** Something in a settings place to bring into view, once (Settings → Security → Devices). */
  settingsFocus?: string;
  paletteOpen: boolean;
  /** Undo's preview is open for these change sets (ADR 0030). */
  undoing?: { ids: string[]; direction: 'undo' | 'redo' };
  /**
   * Talk mode is open (ADR 0027). `from`: where the answer to what was just
   * said starts in the chat, so a new chat (which opens on its own page)
   * still speaks it.
   */
  talking?: { from?: number };
  /** Asking whether to stop holding a chat to a skill's list (ADR 0047), e.g. from ⌘K. */
  stopHolding?: { conversationId: string; skillId: string };
  find: FindState | null;
  /** What find last searched for, so ⌘F reopens where you left off. */
  lastFind?: { conversationId: string; query: string };
  /** The header usage popover (so `/usage` and the composer notice can open it). */
  usageOpen: boolean;
  /** The chat whose spending chip is open (ADR 0073), e.g. from ⌘K. */
  chatSpendOpen: string | null;
  picker: Picker;
  /** Model/effort/mode chosen for a new chat before its first message. */
  draftOptions: TurnOptions;
  /** Words to put in the open chat's composer (e.g. `/weekly-review ` from ⌘K). */
  composerText: string | null;
  setComposerText(text: string | null): void;
  /** Bumped to open the chat's file picker (⌘K "Attach files"). */
  attachRequest: number;
  requestAttach(): void;
  /** Bumped to send the open chat's draft off as a background task (⌘K, ⌘⇧↩). */
  backgroundRequest: number;
  requestBackground(): void;
  setPicker(picker: Picker): void;
  setDraftOptions(options: TurnOptions): void;
  toggleSidebar(): void;
  setMobileSidebar(open: boolean): void;
  /**
   * Settings is a page with an address (`/settings/<place>`): this goes there.
   * `focus`: a provider's own page under Providers (to sign in), or anything
   * else to bring into view once.
   */
  openSettings(tab?: SettingsTab, focus?: string, move?: SettingsMove): void;
  setRestarting(restarting: UiState['restarting']): void;
  /** Back to the page Settings opened over. Going anywhere else leaves it too. */
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
  /** Something the assistant made, open beside a chat (ADR 0034). `version`: a past one. */
  artifactOpen: { conversationId: string; artifactId: string; version?: number } | null;
  /** When you last closed a chat's artifact panel: it only opens by itself for newer things. */
  artifactDismissed: Record<string, number>;
  artifactWidth: number;
  openArtifact(conversationId: string, artifactId: string, version?: number): void;
  closeArtifact(): void;
  /** A Conch app's page beside a chat (ADR 0061); one panel at a time, like the others. */
  appPageOpen: AppPageOpen | null;
  openAppPage(open: AppPageOpen): void;
  closeAppPage(): void;
  /** Open this one straight into editing by hand (⌘K's "Edit …", ADR 0046). */
  artifactEditRequest?: string;
  setArtifactWidth(width: number): void;
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
const ARTIFACT_WIDTH_KEY = 'conch.artifactWidth';

function storedHeight(): number {
  const value =
    typeof localStorage === 'undefined' ? NaN : Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
  return Number.isFinite(value) && value >= 160 ? value : 300;
}

function storedWidth(key = BROWSER_WIDTH_KEY): number {
  const value = typeof localStorage === 'undefined' ? NaN : Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 320 ? value : 560;
}

export const useUi = create<UiState>((set) => ({
  sidebarOpen: typeof localStorage === 'undefined' || localStorage.getItem(SIDEBAR_KEY) !== '0',
  mobileSidebarOpen: false,
  paletteOpen: false,
  find: null,
  usageOpen: false,
  chatSpendOpen: null,
  picker: null,
  draftOptions: {},
  composerText: null,
  setComposerText: (composerText) => set({ composerText }),
  attachRequest: 0,
  requestAttach: () => set((state) => ({ attachRequest: state.attachRequest + 1 })),
  backgroundRequest: 0,
  requestBackground: () => set((state) => ({ backgroundRequest: state.backgroundRequest + 1 })),
  setPicker: (picker) => set({ picker }),
  setDraftOptions: (draftOptions) => set({ draftOptions }),
  toggleSidebar: () =>
    set((s) => {
      localStorage.setItem(SIDEBAR_KEY, s.sidebarOpen ? '0' : '1');
      return { sidebarOpen: !s.sidebarOpen };
    }),
  setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  openSettings: (tab, focus, move) => {
    // A provider's page is a place of its own; any other focus is brought into view.
    const item = tab === 'providers' ? focus : undefined;
    set({ settingsFocus: item ? undefined : focus, paletteOpen: false });
    showSettings(tab, item, move);
  },
  // The whole page rests while Conch starts again: nothing stays open over the calm
  // screen (Settings steps aside, and is where it was after the reload).
  setRestarting: (restarting) =>
    set(restarting ? { restarting, paletteOpen: false } : { restarting }),
  closeSettings: () => leaveSettings(),
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
  // One panel beside the chat at a time: the browser or something made.
  openBrowser: (browserFor) =>
    set({ browserFor, artifactOpen: null, appPageOpen: null, paletteOpen: false }),
  closeBrowser: () =>
    set((s) =>
      s.browserFor
        ? {
            browserFor: null,
            browserDismissed: { ...s.browserDismissed, [s.browserFor]: Date.now() },
          }
        : s,
    ),
  artifactOpen: null,
  artifactDismissed: {},
  artifactWidth: storedWidth(ARTIFACT_WIDTH_KEY),
  openArtifact: (conversationId, artifactId, version) =>
    set({
      artifactOpen: { conversationId, artifactId, version },
      appPageOpen: null,
      browserFor: null,
      paletteOpen: false,
    }),
  appPageOpen: null,
  openAppPage: (appPageOpen) =>
    set({ appPageOpen, artifactOpen: null, browserFor: null, paletteOpen: false }),
  closeAppPage: () => set({ appPageOpen: null }),
  closeArtifact: () =>
    set((s) =>
      s.artifactOpen
        ? {
            artifactOpen: null,
            artifactDismissed: {
              ...s.artifactDismissed,
              [s.artifactOpen.conversationId]: Date.now(),
            },
          }
        : s,
    ),
  setArtifactWidth: (artifactWidth) => {
    try {
      localStorage.setItem(ARTIFACT_WIDTH_KEY, String(Math.round(artifactWidth)));
    } catch {
      // Private windows: the width just isn't remembered.
    }
    set({ artifactWidth });
  },
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

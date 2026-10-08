/**
 * The glowing edge (ADR 0110): while the assistant uses this computer's apps,
 * every screen wears a soft pearl-coloured glow at its edges, and a small
 * card at the top says what it's doing beside a Stop button. ⌘⎋ stops it
 * from anywhere. Neither ever takes a click or the keyboard from the app
 * being used, and both are left out of screen pictures (content protection),
 * so the assistant never sees, or aims at, its own Stop.
 *
 * Electron is reached through `OverlayDeps`, so a test can stand in for it.
 */
import type { BrowserWindowConstructorOptions } from 'electron';

import { APP_SCHEME } from './policy';

/** The title both windows carry: the gateway looks through windows with it (`computer-use/driver.ts`). */
export const EDGE_TITLE = 'Conch is using your computer';

/** The keys that stop it: ⌘⎋ on a Mac. */
export const STOP_ACCELERATOR = 'CommandOrControl+Escape';

export const EDGE_PAGE = `${APP_SCHEME}://app/edge.html`;
export const STOP_PAGE = `${APP_SCHEME}://app/stop.html`;

/** The Stop card's size, in points. */
const CARD = { width: 380, height: 56, top: 10 };

export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a BrowserWindow the overlay uses. */
export interface OverlayWindow {
  setIgnoreMouseEvents(ignore: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver'): void;
  setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  setContentProtection(enable: boolean): void;
  loadURL(url: string): Promise<void>;
  showInactive(): void;
  destroy(): void;
  isDestroyed(): boolean;
  webContents: {
    on(event: 'did-navigate-in-page', listener: (event: unknown, url: string) => void): unknown;
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }) => void): unknown;
  };
}

export interface OverlayDeps {
  create(options: BrowserWindowConstructorOptions): OverlayWindow;
  /** Every screen's bounds, the main one first, with its work area. */
  displays(): { bounds: OverlayRect; workArea: OverlayRect }[];
  register(accelerator: string, pressed: () => void): boolean;
  unregister(accelerator: string): void;
  /** Stop was pressed: on the card, or with the keys. */
  onStop(): void;
  platform?: NodeJS.Platform;
}

const SEALED: BrowserWindowConstructorOptions['webPreferences'] = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  devTools: false,
  spellcheck: false,
  backgroundThrottling: false,
};

/** A window that floats over everything and never becomes the app in front. */
export function floating(
  bounds: OverlayRect,
  platform: NodeJS.Platform,
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    title: EDGE_TITLE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    // A panel on a Mac never activates Conch, so the app being used keeps the keyboard.
    ...(platform === 'darwin' && { type: 'panel' }),
    webPreferences: SEALED,
  };
}

/** Where the Stop card sits: the middle of the main screen's top. */
export function cardBounds(workArea: OverlayRect): OverlayRect {
  return {
    x: Math.round(workArea.x + (workArea.width - CARD.width) / 2),
    y: workArea.y + CARD.top,
    width: CARD.width,
    height: CARD.height,
  };
}

/** What the card's page reads from its address: `#l=Clicking%20in%20Notes`. */
export function labelHash(label: string): string {
  return `#l=${encodeURIComponent(label.slice(0, 160))}`;
}

export class ComputerOverlay {
  #edges: OverlayWindow[] = [];
  #card?: OverlayWindow;
  #keys = false;
  #label = '';

  constructor(private readonly deps: OverlayDeps) {}

  get showing(): boolean {
    return this.#edges.length > 0;
  }

  /** Light the edge (or say what it's doing now), or put it out. */
  set(on: boolean, label = 'Using your computer'): void {
    if (!on) return this.hide();
    this.#label = label;
    if (this.showing) {
      void this.#card?.loadURL(`${STOP_PAGE}${labelHash(label)}`).catch(() => undefined);
      return;
    }
    this.#show();
  }

  #show(): void {
    const platform = this.deps.platform ?? process.platform;
    const displays = this.deps.displays();
    for (const display of displays) {
      const edge = this.deps.create(floating(display.bounds, platform));
      this.#float(edge);
      // The glow never takes a click: everything goes through to the app under it.
      edge.setIgnoreMouseEvents(true);
      void edge.loadURL(EDGE_PAGE).then(
        () => !edge.isDestroyed() && edge.showInactive(),
        () => undefined,
      );
      this.#edges.push(edge);
    }
    const main = displays[0];
    if (main) {
      const card = this.deps.create(floating(cardBounds(main.workArea), platform));
      this.#float(card);
      // Its one button is a link to `#stop`: nothing else on it does anything.
      card.webContents.on('did-navigate-in-page', (_event, url) => {
        if (new URL(url).hash === '#stop') this.#stop();
      });
      card.webContents.on('will-navigate', (event) => event.preventDefault());
      void card.loadURL(`${STOP_PAGE}${labelHash(this.#label)}`).then(
        () => !card.isDestroyed() && card.showInactive(),
        () => undefined,
      );
      this.#card = card;
    }
    this.#keys = this.deps.register(STOP_ACCELERATOR, () => this.#stop());
  }

  #float(window: OverlayWindow): void {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Left out of every screen picture: the assistant never sees its own Stop.
    window.setContentProtection(true);
  }

  #stop(): void {
    this.hide();
    this.deps.onStop();
  }

  hide(): void {
    for (const window of [...this.#edges, ...(this.#card ? [this.#card] : [])])
      if (!window.isDestroyed()) window.destroy();
    this.#edges = [];
    this.#card = undefined;
    if (this.#keys) this.deps.unregister(STOP_ACCELERATOR);
    this.#keys = false;
  }
}

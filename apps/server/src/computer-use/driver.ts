import type { ComputerUseAccessKind, ComputerUseAccessState } from '@conch/protocol';

import type { KeyCombo, Rect, ScreenApp } from './policy';

/** A window on the screen, front to back, as the system lists them. */
export interface ScreenWindow {
  app: ScreenApp;
  /** Its title, when the system says (it needs Screen Recording). */
  title: string;
  /** In points, from the top left of the main screen. */
  bounds: Rect;
  /** 0 for app windows; the menu bar, the Dock and pop-ups sit higher. */
  layer: number;
}

export type MouseButton = 'left' | 'right' | 'middle';

export type PointerAction =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'click'; x: number; y: number; button: MouseButton; count: 1 | 2 | 3 }
  | { kind: 'drag'; x: number; y: number; toX: number; toY: number };

/**
 * The hands and eyes on one kind of computer (ADR 0110). It does exactly what
 * it's told, and nothing decides here: the tools check every rule first. A
 * test stands in for it with a pretend screen.
 */
export interface ComputerDriver {
  readonly platform: 'mac' | 'unsupported';
  /** The two switches the system keeps: seeing the screen, and clicking and typing. */
  access(): Promise<Record<ComputerUseAccessKind, ComputerUseAccessState>>;
  /** Put Conch on the switch's list (where the system allows it), then open the page with it. */
  request(kind: ComputerUseAccessKind): Promise<void>;
  /** The main screen's size, in points. */
  screen(): Promise<{ width: number; height: number }>;
  /** The app in front, and every window on screen, front to back. */
  windows(): Promise<{ front?: ScreenApp; windows: ScreenWindow[] }>;
  /**
   * A picture of the main screen, `width`×`height` pixels, as JPEG, with
   * `cover` (in the picture's pixels) painted over. Never kept on disk.
   */
  capture(
    size: { width: number; height: number },
    cover: Rect[],
    signal?: AbortSignal,
  ): Promise<Buffer>;
  pointer(action: PointerAction): Promise<void>;
  keys(combo: KeyCombo, repeat?: number): Promise<void>;
  /** Types `text` into whatever has focus. Stops between pieces when `signal` aborts. */
  type(text: string, signal?: AbortSignal): Promise<void>;
  /** Scroll at a point: `dy` lines up (+) or down (−), `dx` right (+) or left (−). */
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  /** The app people call `name`, if it's installed. */
  find(name: string): Promise<ScreenApp | undefined>;
  /** Open (or bring to the front) an app found with `find`. */
  open(app: ScreenApp): Promise<void>;
  /** The apps open now, with a window people use. */
  apps(): Promise<ScreenApp[]>;
}

/** Everywhere Conch can't use the apps yet: it says so, and never pretends. */
export const UNSUPPORTED: ComputerDriver = {
  platform: 'unsupported',
  access: () => Promise.resolve({ screen: 'unknown', control: 'unknown' }),
  request: () => Promise.reject(new Error('Not on this computer yet.')),
  screen: () => Promise.reject(new Error('Not on this computer yet.')),
  windows: () => Promise.resolve({ windows: [] }),
  capture: () => Promise.reject(new Error('Not on this computer yet.')),
  pointer: () => Promise.reject(new Error('Not on this computer yet.')),
  keys: () => Promise.reject(new Error('Not on this computer yet.')),
  type: () => Promise.reject(new Error('Not on this computer yet.')),
  scroll: () => Promise.reject(new Error('Not on this computer yet.')),
  find: () => Promise.resolve(undefined),
  open: () => Promise.reject(new Error('Not on this computer yet.')),
  apps: () => Promise.resolve([]),
};

/** The window under a point, front to back, skipping Conch's own glowing edge. */
export function windowAt(
  windows: readonly ScreenWindow[],
  x: number,
  y: number,
): ScreenWindow | undefined {
  return windows.find(
    (w) =>
      !isEdge(w) &&
      x >= w.bounds.x &&
      y >= w.bounds.y &&
      x < w.bounds.x + w.bounds.width &&
      y < w.bounds.y + w.bounds.height,
  );
}

/** The title the desktop app gives its glowing edge and Stop button (apps/desktop `overlay.ts`). */
export const EDGE_TITLE = 'Conch is using your computer';

/** One of the desktop app's own overlay windows: never what's being clicked. */
export function isEdge(window: ScreenWindow): boolean {
  return (
    (window.app.name === 'Conch' || window.app.name === 'Electron') && window.title === EDGE_TITLE
  );
}

/**
 * Turning your mouse and keyboard on the live view into input for the page.
 * Positions are 0–1 of the screen, so nothing here needs the page's pixel
 * size; the gateway multiplies them out.
 */

export interface BrowserModifiers {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type BrowserInput =
  | {
      type: 'mouse';
      action: 'move' | 'down' | 'up' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: BrowserModifiers;
    }
  | {
      type: 'key';
      action: 'down' | 'up';
      key: string;
      code: string;
      text?: string;
      modifiers?: BrowserModifiers;
    }
  | { type: 'text'; text: string };

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Where a pointer is on the screen, 0–1 each way. */
export function pointOn(rect: Rect, clientX: number, clientY: number): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height),
  };
}

export function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): BrowserModifiers | undefined {
  const mods: BrowserModifiers = {};
  if (event.altKey) mods.alt = true;
  if (event.ctrlKey) mods.ctrl = true;
  if (event.metaKey) mods.meta = true;
  if (event.shiftKey) mods.shift = true;
  return Object.keys(mods).length ? mods : undefined;
}

const BUTTONS = ['left', 'middle', 'right'] as const;

export function buttonOf(button: number): 'left' | 'middle' | 'right' {
  return BUTTONS[button] ?? 'left';
}

/**
 * Wheel deltas in pixels, whatever the device reports (lines, pages), scaled
 * from the view's size to the page's.
 */
export function wheelDelta(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  scale: number,
): { deltaX: number; deltaY: number } {
  const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
  return { deltaX: event.deltaX * unit * scale, deltaY: event.deltaY * unit * scale };
}

/**
 * A key press as page input. Printable characters carry `text`; shortcuts
 * (Ctrl/⌘ held) don't, so they act as keys. Returns undefined for keys that
 * never belong to the page.
 */
export function keyInput(
  action: 'down' | 'up',
  event: {
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    isComposing?: boolean;
  },
): BrowserInput | undefined {
  if (event.isComposing || event.key === 'Process' || event.key === 'Unidentified')
    return undefined;
  const modifiers = modifiersOf(event);
  const shortcut = event.ctrlKey || event.metaKey;
  const printable = [...event.key].length === 1;
  return {
    type: 'key',
    action,
    key: event.key,
    code: event.code,
    text: printable && !shortcut ? event.key : undefined,
    modifiers,
  };
}

/** The key that hands focus back to the app while you're driving (everything else goes to the page). */
export function isReleaseKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'Escape' && event.shiftKey;
}

/** A browser's own key, not the page's: what it does. */
export type BrowserShortcut =
  | { kind: 'address' | 'new' | 'close' | 'reopen' | 'next' | 'previous' | 'back' | 'forward' }
  | { kind: 'nth'; index: number };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The keys every browser has: ⌘L the address, ⌘T a new tab, ⌘W close it,
 * ⌘⇧T bring it back, Ctrl+Tab the next, ⌘1–8 a tab, ⌘9 the last, Alt+←/→
 * (⌘[ / ⌘] on a Mac) back and forward. ⌘ is Ctrl off a Mac.
 */
export function browserShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  mac = isMac,
): BrowserShortcut | undefined {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'Tab')
    return { kind: event.shiftKey ? 'previous' : 'next' };
  if (mod && !event.altKey) {
    if (!event.shiftKey && key === 'l') return { kind: 'address' };
    if (!event.shiftKey && key === 't') return { kind: 'new' };
    if (event.shiftKey && key === 't') return { kind: 'reopen' };
    if (!event.shiftKey && key === 'w') return { kind: 'close' };
    if (!event.shiftKey && /^Digit[1-9]$/.test(event.code)) {
      const n = Number(event.code.slice(5));
      return { kind: 'nth', index: n === 9 ? -1 : n - 1 };
    }
    if (mac && !event.shiftKey && key === '[') return { kind: 'back' };
    if (mac && !event.shiftKey && key === ']') return { kind: 'forward' };
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (key === 'ArrowLeft') return { kind: 'back' };
    if (key === 'ArrowRight') return { kind: 'forward' };
  }
  return undefined;
}

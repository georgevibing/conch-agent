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

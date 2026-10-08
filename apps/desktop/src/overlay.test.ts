import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BrowserWindowConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  cardBounds,
  ComputerOverlay,
  EDGE_PAGE,
  EDGE_TITLE,
  labelHash,
  STOP_ACCELERATOR,
  STOP_PAGE,
  type OverlayWindow,
} from './overlay';
import { appFile } from './policy';

class FakeWindow implements OverlayWindow {
  ignored = false;
  protectedContent = false;
  level?: string;
  urls: string[] = [];
  shown = false;
  destroyed = false;
  listeners = new Map<string, (...args: never[]) => void>();
  webContents = {
    on: (event: string, listener: (...args: never[]) => void) => {
      this.listeners.set(event, listener);
      return this.webContents;
    },
  } as OverlayWindow['webContents'];
  constructor(readonly options: BrowserWindowConstructorOptions) {}
  setIgnoreMouseEvents(ignore: boolean) {
    this.ignored = ignore;
  }
  setAlwaysOnTop(_flag: boolean, level?: 'screen-saver') {
    this.level = level;
  }
  setVisibleOnAllWorkspaces() {}
  setContentProtection(enable: boolean) {
    this.protectedContent = enable;
  }
  loadURL(url: string) {
    this.urls.push(url);
    return Promise.resolve();
  }
  showInactive() {
    this.shown = true;
  }
  destroy() {
    this.destroyed = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
  /** Someone pressed the card's Stop link. */
  navigate(url: string) {
    (
      this.listeners.get('did-navigate-in-page') as ((e: unknown, url: string) => void) | undefined
    )?.({}, url);
  }
}

function setup() {
  const windows: FakeWindow[] = [];
  const keys = new Map<string, () => void>();
  const onStop = vi.fn();
  const overlay = new ComputerOverlay({
    create: (options) => {
      const window = new FakeWindow(options);
      windows.push(window);
      return window;
    },
    displays: () => [
      {
        bounds: { x: 0, y: 0, width: 1512, height: 982 },
        workArea: { x: 0, y: 33, width: 1512, height: 949 },
      },
      {
        bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1512, y: 25, width: 2560, height: 1415 },
      },
    ],
    register: (accelerator, pressed) => {
      keys.set(accelerator, pressed);
      return true;
    },
    unregister: (accelerator) => void keys.delete(accelerator),
    onStop,
    platform: 'darwin',
  });
  return { overlay, windows, keys, onStop };
}

describe('the glowing edge', () => {
  it('lights every screen, never takes a click, and stays out of screen pictures', async () => {
    const { overlay, windows } = setup();
    overlay.set(true, 'Clicking in Notes');
    await Promise.resolve();
    const edges = windows.filter((w) => w.urls[0] === EDGE_PAGE);
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      expect(edge.ignored).toBe(true);
      expect(edge.protectedContent).toBe(true);
      expect(edge.level).toBe('screen-saver');
      expect(edge.options).toMatchObject({
        focusable: false,
        transparent: true,
        title: EDGE_TITLE,
        type: 'panel',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
    }
    expect(edges[1]?.options).toMatchObject({ x: 1512, width: 2560 });
  });

  it('puts the Stop card on the main screen, saying what it’s doing', async () => {
    const { overlay, windows } = setup();
    overlay.set(true, 'Typing in Notes');
    const card = windows.find((w) => w.urls[0]?.startsWith(STOP_PAGE));
    expect(card?.urls[0]).toBe(`${STOP_PAGE}${labelHash('Typing in Notes')}`);
    expect(card?.protectedContent).toBe(true);
    expect(card?.ignored).toBe(false);
    expect(card?.options).toMatchObject(cardBounds({ x: 0, y: 33, width: 1512, height: 949 }));
    overlay.set(true, 'Pressing cmd+s in Notes');
    expect(card?.urls.at(-1)).toBe(`${STOP_PAGE}${labelHash('Pressing cmd+s in Notes')}`);
    // Saying something new never lights a second edge.
    expect(windows).toHaveLength(3);
  });

  it('stops with ⌘⎋ from anywhere, and lets the keys go after', () => {
    const { overlay, keys, onStop, windows } = setup();
    overlay.set(true);
    expect(keys.has(STOP_ACCELERATOR)).toBe(true);
    keys.get(STOP_ACCELERATOR)?.();
    expect(onStop).toHaveBeenCalledOnce();
    expect(keys.has(STOP_ACCELERATOR)).toBe(false);
    expect(windows.every((w) => w.destroyed)).toBe(true);
    expect(overlay.showing).toBe(false);
  });

  it('stops from the card’s button, and nothing else on it', () => {
    const { overlay, windows, onStop } = setup();
    overlay.set(true);
    const card = windows.find((w) => w.urls[0]?.startsWith(STOP_PAGE));
    card?.navigate(`${STOP_PAGE}#l=whatever`);
    expect(onStop).not.toHaveBeenCalled();
    card?.navigate(`${STOP_PAGE}#stop`);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('goes out when the turn ends, without saying Stop', () => {
    const { overlay, windows, onStop, keys } = setup();
    overlay.set(true);
    overlay.set(false);
    expect(windows.every((w) => w.destroyed)).toBe(true);
    expect(keys.size).toBe(0);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('serves its pages, and each says the title the gateway looks through', () => {
    expect(appFile(EDGE_PAGE)).toBe('edge.html');
    expect(appFile(STOP_PAGE)).toBe('stop.html');
    expect(appFile('conch-app://app/stop.js')).toBe('stop.js');
    for (const page of ['edge.html', 'stop.html']) {
      const html = readFileSync(join(import.meta.dirname, '..', 'pages', page), 'utf8');
      expect(html).toContain(`<title>${EDGE_TITLE}</title>`);
      expect(html).toContain('prefers-reduced-motion: reduce');
    }
  });

  it('keeps the label to words', () => {
    expect(labelHash('<b>hi</b>')).toBe('#l=%3Cb%3Ehi%3C%2Fb%3E');
    expect(decodeURIComponent(labelHash('x'.repeat(400)).slice(3))).toHaveLength(160);
  });
});

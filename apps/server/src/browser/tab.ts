import type {
  BrowserBox,
  BrowserControl,
  BrowserHandoff,
  BrowserLiveCommand,
  BrowserLiveEvent,
  BrowserTab as TabState,
} from '@conch/protocol';
import type { CDPSession, Locator, Page } from 'playwright-core';

import { VIEWPORT } from './runtime';

/** Someone looking at a conversation's tab through `/api/browser/live`. */
export interface Watcher {
  /** The panel is on screen. Frames only flow while someone looks. */
  visible: boolean;
  send(event: BrowserLiveEvent): void;
  /** One JPEG. Latest wins: the watcher drops frames it can't send in time. */
  frame(jpeg: Buffer): void;
}

interface Modifiers { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean }

const MODIFIER_KEYS: [keyof Modifiers, string][] = [
  ['alt', 'Alt'],
  ['ctrl', 'Control'],
  ['meta', 'Meta'],
  ['shift', 'Shift'],
];

/**
 * One conversation's tab. Popups (a "Sign in with Google" window) stack on
 * top and the view follows the newest; when one closes, the view returns to
 * the page that opened it.
 */
export class Tab {
  control: BrowserControl = 'idle';
  handoff?: BrowserHandoff;
  /** Sites you allowed for this chat ("This chat" on a site prompt). */
  readonly sites = new Set<string>();
  /** You drove since the agent last acted: its next result says so. */
  touched = false;
  lastUsed = Date.now();
  #pages: Page[] = [];
  #cdp?: { page: Page; session: CDPSession };
  #waiters = new Set<() => void>();
  #closed = false;

  constructor(
    readonly conversationId: string,
    page: Page,
    private readonly watchers: () => Set<Watcher>,
    private readonly hooks: {
      /** The tab's address, title, loading or driver changed. */
      changed: (tab: Tab) => void;
      /** A page finished loading (decline cookie banners etc.). */
      loaded: (page: Page) => void;
      /** A page crashed and was reloaded. */
      crashed: () => void;
    },
  ) {
    this.#adopt(page);
  }

  get page(): Page {
    const page = this.#pages.at(-1);
    if (!page) throw new Error('This tab has no page.');
    return page;
  }

  /** The page in view, if the tab still has one. */
  get current(): Page | undefined {
    return this.#pages.at(-1);
  }

  get closed(): boolean {
    return this.#closed;
  }

  #adopt(page: Page): void {
    this.#pages.push(page);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.hooks.changed(this);
    });
    page.on('load', () => {
      this.hooks.changed(this);
      this.hooks.loaded(page);
    });
    page.on('popup', (popup) => {
      this.#adopt(popup);
      void this.refresh();
      this.hooks.changed(this);
    });
    page.on('close', () => {
      this.#pages = this.#pages.filter((p) => p !== page);
      if (this.#pages.length === 0) {
        this.#closed = true;
      } else {
        void this.refresh();
      }
      this.hooks.changed(this);
    });
    page.on('crash', () => {
      this.hooks.crashed();
      void page.reload().catch(() => undefined);
    });
  }

  async state(): Promise<TabState> {
    const page = this.page;
    const url = page.url();
    return {
      conversationId: this.conversationId,
      url: url === 'about:blank' ? '' : url,
      title: await page.title().catch(() => ''),
      loading: false,
      canGoBack: this.#pages.length > 1 || url !== 'about:blank',
      canGoForward: false,
      control: this.control,
      viewport: VIEWPORT,
      handoff: this.handoff,
    };
  }

  // ── Who's driving ─────────────────────────────────────────────────────

  setControl(control: BrowserControl): void {
    if (this.control === control) return;
    this.control = control;
    if (control === 'user') this.touched = true;
    if (control !== 'user') {
      for (const wake of this.#waiters) wake();
      this.#waiters.clear();
    }
    this.hooks.changed(this);
  }

  /** Resolves once you're not driving (right away if you aren't). Rejects if `signal` aborts. */
  whenFree(signal: AbortSignal): Promise<void> {
    if (this.control !== 'user') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wake = () => {
        signal.removeEventListener('abort', stop);
        resolve();
      };
      const stop = () => {
        this.#waiters.delete(wake);
        reject(new Error('stopped'));
      };
      this.#waiters.add(wake);
      signal.addEventListener('abort', stop, { once: true });
    });
  }

  // ── The picture ───────────────────────────────────────────────────────

  /** Start or stop the screencast to match who's watching, on the page in view. */
  async refresh(): Promise<void> {
    const wanted = !this.#closed && [...this.watchers()].some((w) => w.visible);
    const page = this.#pages.at(-1);
    if (this.#cdp && (!wanted || this.#cdp.page !== page)) {
      const { session } = this.#cdp;
      this.#cdp = undefined;
      await session.send('Page.stopScreencast').catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
    if (!wanted || !page || this.#cdp) return;
    const session = await page.context().newCDPSession(page);
    this.#cdp = { page, session };
    session.on('Page.screencastFrame', (frame) => {
      void session
        .send('Page.screencastFrameAck', { sessionId: frame.sessionId })
        .catch(() => undefined);
      const jpeg = Buffer.from(frame.data, 'base64');
      for (const watcher of this.watchers()) if (watcher.visible) watcher.frame(jpeg);
    });
    await session
      .send('Page.startScreencast', {
        format: 'jpeg',
        quality: 72,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
        everyNthFrame: 1,
      })
      .catch(() => undefined);
  }

  get watched(): boolean {
    return [...this.watchers()].some((w) => w.visible);
  }

  /** Tell watchers what the agent is about to do, and where. */
  announce(event: Extract<BrowserLiveEvent, { type: 'action' }>): void {
    for (const watcher of this.watchers()) watcher.send(event);
  }

  /** Where a control is, as 0–1 of the viewport, for the agent's cursor. */
  async boxOf(locator: Locator): Promise<BrowserBox | undefined> {
    const box = await locator.boundingBox({ timeout: 1_500 }).catch(() => null);
    if (!box) return undefined;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return {
      x: clamp(box.x / VIEWPORT.width),
      y: clamp(box.y / VIEWPORT.height),
      width: clamp(box.width / VIEWPORT.width),
      height: clamp(box.height / VIEWPORT.height),
    };
  }

  /** A small JPEG of the page for the transcript (about 320×200). */
  async thumbnail(): Promise<Buffer | undefined> {
    const page = this.page;
    try {
      const session = await page.context().newCDPSession(page);
      try {
        const shot = await session.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 60,
          clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 0.25 },
        });
        return Buffer.from(shot.data, 'base64');
      } finally {
        await session.detach().catch(() => undefined);
      }
    } catch {
      return undefined;
    }
  }

  // ── Your hands ────────────────────────────────────────────────────────

  /** Mouse and keyboard from the live view. Only while you're driving. */
  async input(command: BrowserLiveCommand): Promise<void> {
    const page = this.page;
    this.lastUsed = Date.now();
    switch (command.type) {
      case 'mouse': {
        const x = command.x * VIEWPORT.width;
        const y = command.y * VIEWPORT.height;
        const button = command.button ?? 'left';
        if (command.action === 'move') return page.mouse.move(x, y);
        if (command.action === 'wheel') {
          await page.mouse.move(x, y);
          return page.mouse.wheel(command.deltaX ?? 0, command.deltaY ?? 0);
        }
        await page.mouse.move(x, y);
        if (command.action === 'down')
          return page.mouse.down({ button, clickCount: command.clickCount ?? 1 });
        return page.mouse.up({ button, clickCount: command.clickCount ?? 1 });
      }
      case 'key': {
        const held = MODIFIER_KEYS.filter(([flag]) => command.modifiers?.[flag]).map(([, k]) => k);
        const isModifier = MODIFIER_KEYS.some(([, k]) => k === command.key);
        // Printable text without shortcuts goes in as text: it survives any keyboard layout.
        if (
          command.action === 'down' &&
          command.text &&
          !command.modifiers?.ctrl &&
          !command.modifiers?.meta
        ) {
          return page.keyboard.insertText(command.text);
        }
        if (command.text && command.action === 'up') return;
        try {
          if (command.action === 'down') {
            if (!isModifier) for (const key of held) await page.keyboard.down(key);
            await page.keyboard.down(command.key);
          } else {
            await page.keyboard.up(command.key);
            if (!isModifier) for (const key of held.reverse()) await page.keyboard.up(key);
          }
        } catch {
          // A key Playwright doesn't know (dead keys, media keys): ignore it.
        }
        return;
      }
      case 'text':
        return page.keyboard.insertText(command.text);
      default:
        return;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const wake of this.#waiters) wake();
    this.#waiters.clear();
    await this.refresh();
    await Promise.all(this.#pages.map((p) => p.close().catch(() => undefined)));
    this.#pages = [];
  }
}

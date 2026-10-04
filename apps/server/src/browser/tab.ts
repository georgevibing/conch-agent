import type {
  BrowserBackendKind,
  BrowserBox,
  BrowserControl,
  BrowserHandoff,
  BrowserLiveCommand,
  BrowserLiveEvent,
  BrowserTabEntry,
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

interface Modifiers {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const MODIFIER_KEYS: [keyof Modifiers, string][] = [
  ['alt', 'Alt'],
  ['ctrl', 'Control'],
  ['meta', 'Meta'],
  ['shift', 'Shift'],
];

/** Most tabs one chat keeps open. A new one past this closes the one unused longest. */
export const MAX_TABS = 8;

/** One page in a chat's browser: "t1", "t2"… for the agent and the strip. */
export interface TabEntry {
  id: string;
  page: Page;
  /** The tab that opened it (a popup, a link to a new tab). */
  opener?: string;
  /** When it was last the one in view. */
  seen: number;
}

export interface TabHooks {
  /** The tab's address, title, loading or driver changed. */
  changed: (tab: Tab) => void;
  /** A page finished loading (decline cookie banners etc.). */
  loaded: (page: Page) => void;
  /** A page crashed and was reloaded. */
  crashed: () => void;
  /** A new page joined (a popup, a new tab): contain it, watch its downloads. */
  adopted?: (page: Page) => void | Promise<void>;
  /** The oldest tab was closed to make room: said in the agent's next result. */
  evicted?: (entry: TabEntry) => void;
}

/**
 * One conversation's browser: its tabs, which one is in view, who's driving,
 * and the picture. Popups ("Sign in with Google") and links that open a new
 * tab become tabs of their own and come into view; closing one goes back to
 * the tab that opened it. The agent and the panel see the same tabs.
 */
export class Tab {
  control: BrowserControl = 'idle';
  handoff?: BrowserHandoff;
  /** Sites you allowed for this chat ("This chat" on a site prompt). */
  readonly sites = new Set<string>();
  /** You drove since the agent last acted: its next result says so. */
  touched = false;
  lastUsed = Date.now();
  /** The page's size: desktop-wide, shaped like the panel watching it (see `fit`). */
  viewport = { ...VIEWPORT };
  /** The viewport when the agent last looked at a screenshot: its x,y are in this space. */
  shotViewport?: { width: number; height: number };
  /** Tabs that opened since the agent last heard: said in its next result. */
  readonly opened: string[] = [];
  /** Tabs closed to make room since the agent last heard. */
  readonly evicted: string[] = [];
  #tabs: TabEntry[] = [];
  #active?: TabEntry;
  #next = 1;
  #cdp?: { page: Page; session: CDPSession };
  #waiters = new Set<() => void>();
  #closed = false;

  constructor(
    readonly conversationId: string,
    page: Page,
    private readonly watchers: () => Set<Watcher>,
    private readonly hooks: TabHooks,
    private readonly options: {
      /** Resize pages to the panel's shape. Never in your own Chrome: its windows are yours. */
      emulate: boolean;
      /** Where it runs, for the panel: undefined for Conch's own here. */
      backend?: BrowserBackendKind;
    } = { emulate: true },
  ) {
    this.#adopt(page);
  }

  get page(): Page {
    const page = this.#active?.page;
    if (!page) throw new Error('This tab has no page.');
    return page;
  }

  /** The page in view, if the tab still has one. */
  get current(): Page | undefined {
    return this.#active?.page;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Every tab, in the order they opened. */
  get tabs(): readonly TabEntry[] {
    return this.#tabs;
  }

  get activeId(): string | undefined {
    return this.#active?.id;
  }

  entry(id: string): TabEntry | undefined {
    return this.#tabs.find((t) => t.id === id.trim().toLowerCase());
  }

  /** A page that belongs to this chat now: shown at once. */
  add(page: Page, opener?: string): TabEntry {
    return this.#adopt(page, opener);
  }

  #adopt(page: Page, opener?: string): TabEntry {
    const existing = this.#tabs.find((t) => t.page === page);
    if (existing) return existing;
    const entry: TabEntry = { id: `t${this.#next++}`, page, opener, seen: Date.now() };
    this.#tabs.push(entry);
    void this.hooks.adopted?.(page);
    this.#show(entry);
    if (this.options.emulate) {
      if (page.viewportSize()?.height !== this.viewport.height)
        void page.setViewportSize(this.viewport).catch(() => undefined);
    } else {
      void this.#measure(page);
    }
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.hooks.changed(this);
    });
    page.on('load', () => {
      this.hooks.changed(this);
      this.hooks.loaded(page);
    });
    page.on('popup', (popup) => {
      if (this.#closed) return;
      const child = this.#adopt(popup, entry.id);
      this.opened.push(child.id);
      this.#makeRoom(child);
      this.hooks.changed(this);
    });
    page.on('close', () => {
      const gone = this.#tabs.find((t) => t.page === page);
      this.#tabs = this.#tabs.filter((t) => t.page !== page);
      if (this.#tabs.length === 0) {
        this.#active = undefined;
        this.#closed = true;
      } else if (this.#active?.page === page) {
        // Back to the tab that opened it, else the one in view before.
        const back =
          (gone?.opener && this.#tabs.find((t) => t.id === gone.opener)) ||
          [...this.#tabs].sort((a, b) => b.seen - a.seen)[0];
        if (back) this.#show(back);
      }
      void this.refresh();
      this.hooks.changed(this);
    });
    page.on('crash', () => {
      this.hooks.crashed();
      void page.reload().catch(() => undefined);
    });
    return entry;
  }

  /** Past the limit: the tab unused longest goes (never the one in view or the new one). */
  #makeRoom(keep: TabEntry): void {
    while (this.#tabs.length > MAX_TABS) {
      const oldest = this.#tabs
        .filter((t) => t !== keep && t !== this.#active)
        .sort((a, b) => a.seen - b.seen)[0];
      if (!oldest) return;
      this.#tabs = this.#tabs.filter((t) => t !== oldest);
      this.evicted.push(oldest.id);
      this.hooks.evicted?.(oldest);
      void oldest.page.close().catch(() => undefined);
    }
  }

  #show(entry: TabEntry): void {
    this.#active = entry;
    entry.seen = Date.now();
    void this.refresh();
  }

  /** Your own Chrome keeps its own window size: read it rather than set it. */
  async #measure(page: Page): Promise<void> {
    const size = (await page
      .evaluate('[window.innerWidth, window.innerHeight]')
      .catch(() => undefined)) as [number, number] | undefined;
    if (!size || page !== this.current) return;
    const [width, height] = size;
    if (width > 0 && height > 0) this.viewport = { width, height };
  }

  /** Bring a tab into view. False if there's no such tab. */
  switchTo(id: string): boolean {
    const entry = this.entry(id);
    if (!entry) return false;
    this.#show(entry);
    if (!this.options.emulate) void this.#measure(entry.page);
    void entry.page.bringToFront().catch(() => undefined);
    this.hooks.changed(this);
    return true;
  }

  /** Close one tab (the last one stays: a chat always has a page). */
  async closeTab(id: string): Promise<'closed' | 'missing' | 'last'> {
    const entry = this.entry(id);
    if (!entry) return 'missing';
    if (this.#tabs.length === 1) return 'last';
    await entry.page.close().catch(() => undefined);
    return 'closed';
  }

  /** Each tab's title and address, for the agent and the strip. */
  async list(): Promise<BrowserTabEntry[]> {
    return Promise.all(
      this.#tabs.map(async (t) => {
        const url = t.page.url();
        return {
          id: t.id,
          title: await t.page.title().catch(() => ''),
          url: url === 'about:blank' ? '' : url,
          active: t === this.#active,
        };
      }),
    );
  }

  async state(): Promise<TabState> {
    const page = this.page;
    const url = page.url();
    return {
      conversationId: this.conversationId,
      url: url === 'about:blank' ? '' : url,
      title: await page.title().catch(() => ''),
      loading: false,
      canGoBack: url !== 'about:blank',
      canGoForward: false,
      control: this.control,
      viewport: this.viewport,
      handoff: this.handoff,
      tabs: await this.list(),
      ...(this.options.backend && { backend: this.options.backend }),
    };
  }

  /**
   * Give the page the panel's shape. Width stays desktop-like (so sites don't
   * switch to their phone layout) at about 1.6× the panel, so text stays
   * readable; height follows the panel, so the picture fills it. Your own
   * Chrome is never resized: the panel shows it as it is.
   */
  async fit(stage: { width: number; height: number }): Promise<boolean> {
    if (!this.options.emulate) return false;
    const width = Math.round(Math.min(1440, Math.max(960, stage.width * 1.6)));
    const height = Math.round(Math.min(2400, Math.max(540, (width * stage.height) / stage.width)));
    if (Math.abs(width - this.viewport.width) < 8 && Math.abs(height - this.viewport.height) < 8)
      return false;
    this.viewport = { width, height };
    await Promise.all(
      this.#tabs.map((t) => t.page.setViewportSize(this.viewport).catch(() => undefined)),
    );
    // The screencast is sized at start: begin again at the new size.
    if (this.#cdp) {
      const { session } = this.#cdp;
      this.#cdp = undefined;
      await session.send('Page.stopScreencast').catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
    await this.refresh();
    return true;
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
    const page = this.#active?.page;
    if (this.#cdp && (!wanted || this.#cdp.page !== page)) {
      const { session } = this.#cdp;
      this.#cdp = undefined;
      await session.send('Page.stopScreencast').catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
    if (!wanted || !page || this.#cdp) return;
    let session: CDPSession;
    try {
      session = await page.context().newCDPSession(page);
    } catch {
      return; // The page closed meanwhile.
    }
    // Another refresh got there first, or the view moved on while this one started.
    if (this.#cdp || this.#active?.page !== page) {
      await session.detach().catch(() => undefined);
      return;
    }
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
        maxWidth: this.viewport.width,
        maxHeight: this.viewport.height,
        everyNthFrame: 1,
      })
      .catch(() => undefined);
  }

  get watched(): boolean {
    return [...this.watchers()].some((w) => w.visible);
  }

  /** Tell watchers what the agent is about to do, and where. */
  announce(event: Extract<BrowserLiveEvent, { type: 'action' }>): void {
    const stamped = { ...event, url: this.current?.url() };
    for (const watcher of this.watchers()) watcher.send(stamped);
  }

  /** Where a control is, as 0–1 of the viewport, for the agent's cursor. */
  async boxOf(locator: Locator): Promise<BrowserBox | undefined> {
    const box = await locator.boundingBox({ timeout: 1_500 }).catch(() => null);
    if (!box) return undefined;
    return this.boxAt(box);
  }

  /** A box in page pixels, as 0–1 of the viewport. */
  boxAt(box: { x: number; y: number; width: number; height: number }): BrowserBox {
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return {
      x: clamp(box.x / this.viewport.width),
      y: clamp(box.y / this.viewport.height),
      width: clamp(box.width / this.viewport.width),
      height: clamp(box.height / this.viewport.height),
    };
  }

  /**
   * A small JPEG (320×200) of what's on screen for the transcript, whatever
   * the panel's shape: the top of the view, or the part around `focus` (the
   * control a question is about), with `focus` mapped into the picture.
   */
  async thumbnail(focus?: BrowserBox): Promise<{ jpeg: Buffer; box?: BrowserBox } | undefined> {
    const page = this.page;
    const { width, height } = this.viewport;
    const tall = Math.min(height, Math.round(width / 1.6));
    const centre = focus ? (focus.y + focus.height / 2) * height : tall / 2;
    const top = Math.round(Math.min(height - tall, Math.max(0, centre - tall / 2)));
    try {
      const session = await page.context().newCDPSession(page);
      try {
        // Clips are in page coordinates: add how far the page is scrolled.
        const scroll = (await page
          .evaluate('[window.scrollX, window.scrollY]')
          .catch(() => [0, 0])) as [number, number];
        const shot = await session.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 60,
          clip: { x: scroll[0], y: scroll[1] + top, width, height: tall, scale: 320 / width },
        });
        const box = focus && {
          x: focus.x,
          width: focus.width,
          y: (focus.y * height - top) / tall,
          height: (focus.height * height) / tall,
        };
        return { jpeg: Buffer.from(shot.data, 'base64'), box };
      } finally {
        await session.detach().catch(() => undefined);
      }
    } catch {
      return undefined;
    }
  }

  // ── Your hands ────────────────────────────────────────────────────────

  /** When you last touched the page: a handoff waits until you've paused. */
  lastInput = 0;

  /** Mouse and keyboard from the live view. Only while you're driving. */
  async input(command: BrowserLiveCommand): Promise<void> {
    const page = this.page;
    this.lastUsed = Date.now();
    if (command.type === 'mouse' && command.action === 'move') {
      // Hovering isn't doing anything.
    } else {
      this.lastInput = Date.now();
    }
    switch (command.type) {
      case 'mouse': {
        const x = command.x * this.viewport.width;
        const y = command.y * this.viewport.height;
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
    const pages = this.#tabs.map((t) => t.page);
    this.#tabs = [];
    this.#active = undefined;
    await Promise.all(pages.map((p) => p.close().catch(() => undefined)));
  }
}

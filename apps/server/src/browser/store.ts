import { join } from 'node:path';

import { BrowserSettings, BrowserSite } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

const BrowserFile = z.object({
  version: z.literal(1).default(1),
  settings: BrowserSettings.default(BrowserSettings.parse({})),
  /** Sites you said Conch may always act on ("Always" on a site prompt). */
  sites: z.array(BrowserSite).default([]),
  /**
   * The user agent each browser really sends, learned on its first run. Headless
   * Chrome says "HeadlessChrome", which many sites turn away; Conch sends what
   * the same browser would send with a window.
   */
  userAgents: z.record(z.string(), z.string()).default({}),
});
type BrowserFile = z.infer<typeof BrowserFile>;

/**
 * `~/.conch/browser.json`: the browser's settings and the sites you trust. A
 * damaged file is kept aside and whatever still reads carries on; the rest
 * goes back to the careful defaults (no local pages, no trusted sites).
 */
export class BrowserStore {
  #mutex = new Mutex();
  #cache?: Promise<BrowserFile>;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get #path() {
    return join(this.home, 'browser.json');
  }

  /** The browser's own profile: cookies and sign-ins for the sites you use in Conch. */
  get profileDir(): string {
    return join(this.home, 'browser', 'profile');
  }

  /** Thumbnails of what the agent saw, one folder per conversation. */
  get shotsDir(): string {
    return join(this.home, 'browser', 'shots');
  }

  #read(): Promise<BrowserFile> {
    // A damaged file shouldn't take the browser down.
    this.#cache ??= readStore(this.#path, BrowserFile, {
      onRepair: (state) =>
        this.heal?.(
          'browser',
          state === 'salvaged'
            ? 'Part of the browser settings couldn’t be read, so Conch kept a copy and reset just that part.'
            : 'The browser settings couldn’t be read, so Conch kept a copy and went back to the defaults.',
        ),
    }).then(
      (read) => read.value,
      // Unreadable for a moment (another program has it open): the defaults, and try again later.
      () => {
        this.#cache = undefined;
        return BrowserFile.parse({});
      },
    );
    return this.#cache;
  }

  #write(next: BrowserFile): Promise<void> {
    this.#cache = Promise.resolve(next);
    return writeJson(this.#path, next);
  }

  async settings(): Promise<BrowserSettings> {
    return (await this.#read()).settings;
  }

  updateSettings(patch: Partial<BrowserSettings>): Promise<BrowserSettings> {
    return this.#mutex.run(async () => {
      const current = await this.#read();
      const settings = BrowserSettings.parse({ ...current.settings, ...patch });
      await this.#write({ ...current, settings });
      return settings;
    });
  }

  async sites(): Promise<BrowserSite[]> {
    return (await this.#read()).sites;
  }

  async trusts(site: string): Promise<boolean> {
    return (await this.#read()).sites.some((s) => s.site === site);
  }

  grant(site: string): Promise<void> {
    return this.#mutex.run(async () => {
      const current = await this.#read();
      if (current.sites.some((s) => s.site === site)) return;
      const sites = [...current.sites, { site, grantedAt: Date.now() }].sort((a, b) =>
        a.site.localeCompare(b.site),
      );
      await this.#write({ ...current, sites });
    });
  }

  revoke(site: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const current = await this.#read();
      const sites = current.sites.filter((s) => s.site !== site);
      if (sites.length === current.sites.length) return false;
      await this.#write({ ...current, sites });
      return true;
    });
  }

  async userAgent(key: string): Promise<string | undefined> {
    return (await this.#read()).userAgents[key];
  }

  rememberUserAgent(key: string, userAgent: string): Promise<void> {
    return this.#mutex.run(async () => {
      const current = await this.#read();
      await this.#write({ ...current, userAgents: { ...current.userAgents, [key]: userAgent } });
    });
  }
}

const Secrets = z.object({
  browserbase: z.object({ key: z.string(), project: z.string().optional() }).optional(),
  steel: z.object({ key: z.string() }).optional(),
  /** A DevTools address can carry its own token, so it's kept like a key. */
  cdp: z.object({ address: z.string() }).optional(),
});
export type BrowserSecretsData = z.infer<typeof Secrets>;

/**
 * `~/.conch/browser.secrets.json`: the keys and addresses of browsers Conch
 * reaches elsewhere (ADR 0080), sealed like every key Conch uses (ADR 0025).
 * Never sent to the app, never logged, never in the agent's reach.
 */
export class BrowserSecrets {
  #mutex = new Mutex();
  #cache?: Promise<BrowserSecretsData>;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get path(): string {
    return join(this.home, 'browser.secrets.json');
  }

  read(): Promise<BrowserSecretsData> {
    this.#cache ??= readStore(this.path, Secrets, {
      onRepair: () =>
        this.heal?.(
          'browser',
          'The keys for the cloud browser couldn’t be read, so Conch kept a copy. Add them again in Settings › Browser.',
        ),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        this.#cache = undefined;
        throw error;
      },
    );
    return this.#cache;
  }

  update(fn: (data: BrowserSecretsData) => BrowserSecretsData): Promise<BrowserSecretsData> {
    return this.#mutex.run(async () => {
      const next = Secrets.parse(fn(structuredClone(await this.read())));
      await writeJson(this.path, next);
      this.#cache = Promise.resolve(next);
      return next;
    });
  }
}

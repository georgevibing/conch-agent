import { join } from 'node:path';

import { BrowserSettings, BrowserSite, type UpdateBrowserSettingsBody } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, writeJson } from '../lib/fs';

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

/** `~/.conch/browser.json`: the browser's settings and the sites you trust. */
export class BrowserStore {
  #mutex = new Mutex();
  #cache?: BrowserFile;

  constructor(private readonly home: string) {}

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

  async #read(): Promise<BrowserFile> {
    if (!this.#cache) {
      const raw = await readJson(this.#path).catch(() => undefined);
      const parsed = BrowserFile.safeParse(raw ?? {});
      // A damaged file shouldn't take the browser down: start from defaults.
      this.#cache = parsed.success ? parsed.data : BrowserFile.parse({});
    }
    return this.#cache;
  }

  #write(next: BrowserFile): Promise<void> {
    this.#cache = next;
    return writeJson(this.#path, next);
  }

  async settings(): Promise<BrowserSettings> {
    return (await this.#read()).settings;
  }

  updateSettings(patch: UpdateBrowserSettingsBody): Promise<BrowserSettings> {
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

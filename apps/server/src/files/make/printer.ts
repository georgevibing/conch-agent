/**
 * HTML to PDF and pictures, printed by a Chromium-family browser on this
 * computer (the one the browser feature uses, or the one it downloaded:
 * ADR 0014). It runs apart from the browsing profile, headless, with
 * JavaScript off and every request refused but `data:`, so a page prints
 * exactly what it says and reaches nothing (ADR 0034's seal, on paper).
 *
 * Without a browser it says so (`undefined`), and the makers fall back to
 * Conch's own writer: a PDF is never refused for want of Chrome. It heals
 * what it can (agreement 11): a Snap-packaged Chromium, which can't see the
 * folder Playwright gives it, is tried last; on Linux the browser shares
 * memory through /tmp rather than a small /dev/shm; when no browser here
 * will start, it fetches Conch's own Chromium in the background for the next
 * PDF; and when the system lacks libraries only an administrator can add, it
 * says which command adds them (`problem`), for Repair everything.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';

import { chromium, type Browser, type LaunchOptions, type Page } from 'playwright-core';

import { missingLibraries } from '../../browser/install';
import { findBrowsers } from '../../browser/locate';
import type { PageSize } from './html';

/** CSS pixels at 96 dpi, portrait. */
const PAGE_PX: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 794, height: 1123 },
  Letter: { width: 816, height: 1056 },
  Legal: { width: 816, height: 1344 },
  A5: { width: 559, height: 794 },
};

export interface PrintOptions {
  size: PageSize;
  landscape: boolean;
  /** A footer with the page number (and the title) on every page. */
  footer?: string;
  /** Also a picture of the first page, about this many pixels wide. */
  preview?: number;
  signal?: AbortSignal;
}

/** Why nothing prints, in words for the person and the model; `command`: what only they can run. */
export interface PrinterProblem {
  message: string;
  command?: string;
}

export interface Printer {
  /** Undefined when there's no browser to print with. */
  pdf(html: string, options: PrintOptions): Promise<{ pdf: Buffer; preview?: Buffer } | undefined>;
  /** A picture of the page at `width`×`height` CSS pixels (a chart, a slide). */
  picture(
    html: string,
    size: { width: number; height: number; scale?: number },
    signal?: AbortSignal,
  ): Promise<Buffer | undefined>;
  /** Who prints, in a word, for progress: "Chrome", "Chromium". */
  by(): string | undefined;
  /** Why the last try to print didn't (none: it printed, or hasn't tried). */
  problem?(): PrinterProblem | undefined;
  close(): Promise<void>;
}

const IDLE_MS = 60_000;
const TIMEOUT_MS = 30_000;
/** After every browser refused, how long PDFs go straight to Conch's own writer. */
const RETRY_MS = 10 * 60_000;

interface Candidate {
  id?: string;
  name: string;
  path: string;
}

/**
 * A browser that runs confined by Snap (Ubuntu's Chromium, and the
 * `chromium-browser` script that opens it): it can't read the profile folder
 * Playwright makes in /tmp, so it rarely starts here.
 */
export function snapConfined(path: string): boolean {
  if (path.startsWith('/snap/')) return true;
  try {
    if (realpathSync(path).startsWith('/snap/')) return true;
    if (statSync(path).size > 64 * 1024) return false;
    const head = readFileSync(path).subarray(0, 4096).toString('utf8');
    return head.startsWith('#!') && /\bsnap\b/.test(head);
  } catch {
    return false;
  }
}

function footerTemplate(text: string | undefined): string {
  const words = (text ?? '')
    .slice(0, 120)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<div style="width:100%;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:7.5pt;color:#7a838c;padding:0 20mm;display:flex;justify-content:space-between;"><span>${words}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

const plainName = (name: string) => name.replace(/ \(downloaded by Conch\)$/, '');

export class ChromiumPrinter implements Printer {
  #browser?: Promise<Browser | undefined>;
  #name?: string;
  #idle?: NodeJS.Timeout;
  #busy = 0;
  #problem?: PrinterProblem;
  /** When every browser last refused: PDFs skip printing for a while after. */
  #failedAt?: number;
  #fetching?: Promise<boolean>;

  constructor(
    private readonly deps: {
      /** Where the browsers are (tests hand in their own). */
      locate?: () => Candidate[];
      /** Starts one (tests hand in their own). */
      launch?: (options: LaunchOptions) => Promise<Browser>;
      /**
       * Fetches Conch's own Chromium (`installChromium`). Without it, nothing
       * is downloaded: tests, and the scripted engine.
       */
      install?: (signal?: AbortSignal) => Promise<void>;
      /** Notes what it fixed by itself (Settings → Health → Fixed on its own). */
      heal?: (message: string) => void;
      platform?: NodeJS.Platform;
      now?: () => number;
    } = {},
  ) {}

  #now() {
    return this.deps.now?.() ?? Date.now();
  }

  #resting() {
    return this.#failedAt !== undefined && this.#now() - this.#failedAt < RETRY_MS;
  }

  by(): string | undefined {
    if (this.#resting()) return undefined;
    if (this.#name) return this.#name;
    const found = this.#candidates()[0];
    return found ? plainName(found.name) : undefined;
  }

  problem(): PrinterProblem | undefined {
    return this.#problem;
  }

  /** The browsers to try, in order: Snap-confined ones last. */
  #candidates(): Candidate[] {
    const all = this.deps.locate
      ? this.deps.locate()
      : findBrowsers({
          downloaded: () => {
            try {
              return chromium.executablePath();
            } catch {
              return undefined;
            }
          },
        });
    if ((this.deps.platform ?? osPlatform()) !== 'linux') return all;
    const confined = all.filter((c) => snapConfined(c.path));
    return [...all.filter((c) => !confined.includes(c)), ...confined];
  }

  #args(): string[] {
    return [
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--mute-audio',
      // Containers and small servers give /dev/shm a few megabytes: pages crash in it.
      ...((this.deps.platform ?? osPlatform()) === 'linux' ? ['--disable-dev-shm-usage'] : []),
    ];
  }

  async #launch(): Promise<Browser | undefined> {
    const candidates = this.#candidates();
    let problem: PrinterProblem | undefined;
    for (const candidate of candidates) {
      try {
        const options: LaunchOptions = {
          executablePath: candidate.path,
          headless: true,
          timeout: TIMEOUT_MS,
          args: this.#args(),
        };
        const browser = await (this.deps.launch ?? ((o) => chromium.launch(o)))(options);
        this.#name = plainName(candidate.name);
        if (this.#problem) this.deps.heal?.(`Printing PDFs with ${this.#name} again`);
        this.#problem = undefined;
        this.#failedAt = undefined;
        browser.on('disconnected', () => {
          this.#browser = undefined;
        });
        return browser;
      } catch (error) {
        // The next one, then Conch's own writer.
        const message = String((error as Error)?.message ?? error);
        const libs = missingLibraries(message);
        problem = libs
          ? {
              message: 'The browser that prints PDFs needs system libraries that aren’t installed',
              ...(libs.command && { command: libs.command }),
            }
          : (problem ?? { message: `${plainName(candidate.name)} wouldn’t start to print` });
      }
    }
    this.#name = undefined;
    this.#failedAt = this.#now();
    this.#problem = problem ?? { message: 'there’s no browser on this computer to print with' };
    // A Chromium of Conch's own, for the next PDF, unless the system itself is what's missing.
    if (!problem?.command && !candidates.some((c) => c.id === 'downloaded')) void this.#fetch();
    return undefined;
  }

  /** Conch's own Chromium, fetched once at a time; true when it's there. */
  #fetch(): Promise<boolean> {
    const install = this.deps.install;
    if (!install) return Promise.resolve(false);
    this.#fetching ??= install()
      .then(() => {
        this.#failedAt = undefined;
        this.deps.heal?.('Downloaded Chromium to print PDFs. No browser here would start.');
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this.#fetching = undefined;
      });
    return this.#fetching;
  }

  /**
   * Repair everything: start a browser to print with now. When none here
   * starts, Conch's own Chromium is fetched in the background (`fetching`: a
   * download of minutes outlasts any check), and the next PDF prints with it.
   * Says who prints, or why nothing can.
   */
  async repair(
    signal?: AbortSignal,
  ): Promise<{ by?: string; problem?: PrinterProblem; fetching?: boolean }> {
    signal?.throwIfAborted();
    await this.close();
    this.#failedAt = undefined;
    const browser = await this.#launch();
    if (!browser) return { problem: this.#problem, fetching: Boolean(this.#fetching) };
    this.#browser = Promise.resolve(browser);
    this.#rest();
    return { by: this.#name };
  }

  #rest() {
    clearTimeout(this.#idle);
    if (this.#busy) return;
    this.#idle = setTimeout(() => void this.close(), IDLE_MS);
    this.#idle.unref();
  }

  async #page<T>(
    signal: AbortSignal | undefined,
    use: (page: Page) => Promise<T>,
    deviceScaleFactor = 1,
  ) {
    signal?.throwIfAborted();
    // Every browser refused a moment ago: don't make each PDF wait for them again.
    if (!this.#browser && this.#resting()) return undefined;
    clearTimeout(this.#idle);
    this.#busy++;
    try {
      this.#browser ??= this.#launch();
      const browser = await this.#browser;
      if (!browser) {
        this.#browser = undefined;
        return undefined;
      }
      const context = await browser.newContext({
        javaScriptEnabled: false,
        offline: true,
        serviceWorkers: 'block',
        acceptDownloads: false,
        deviceScaleFactor,
      });
      const stop = () => void context.close().catch(() => undefined);
      signal?.addEventListener('abort', stop, { once: true });
      try {
        // Nothing leaves: the page has what it needs inline, or does without.
        await context.route('**/*', (route) =>
          /^(?:data|about):/i.test(route.request().url()) ? route.continue() : route.abort(),
        );
        const page = await context.newPage();
        page.setDefaultTimeout(TIMEOUT_MS);
        const result = await use(page);
        signal?.throwIfAborted();
        return result;
      } finally {
        signal?.removeEventListener('abort', stop);
        await context.close().catch(() => undefined);
      }
    } finally {
      this.#busy--;
      this.#rest();
    }
  }

  async pdf(html: string, options: PrintOptions) {
    return this.#page(options.signal, async (page) => {
      const px = PAGE_PX[options.size];
      const { width, height } = options.landscape ? { width: px.height, height: px.width } : px;
      await page.setViewportSize({ width, height });
      await page.setContent(html, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        format: options.size,
        landscape: options.landscape,
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: options.footer !== undefined,
        headerTemplate: '<span></span>',
        footerTemplate: footerTemplate(options.footer),
        margin: { top: '22mm', bottom: '24mm', left: '20mm', right: '20mm' },
        outline: true,
        tagged: true,
      });
      let preview: Buffer | undefined;
      if (options.preview) {
        // The first page as it prints: the page's margins drawn as padding. (No script
        // runs in this page, so the style goes in with the content, not added after.)
        const style =
          '<style>@media print { html { background: #fff; } body { padding: 22mm 20mm 24mm !important; margin: 0 !important; max-width: none !important; } }</style>';
        await page.setContent(
          /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : style + html,
          { waitUntil: 'load' },
        );
        const scale = Math.min(1, options.preview / width);
        preview = await page
          .screenshot({ clip: { x: 0, y: 0, width, height }, type: 'png', animations: 'disabled' })
          .then((full) => (scale < 1 ? shrink(page, full, width, height, scale) : full))
          .catch(() => undefined);
      }
      return { pdf, ...(preview && { preview }) };
    });
  }

  async picture(
    html: string,
    size: { width: number; height: number; scale?: number },
    signal?: AbortSignal,
  ) {
    return this.#page(
      signal,
      async (page) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.setContent(html, { waitUntil: 'load' });
        // The viewport is the picture: no clip, which some builds tile at a high pixel ratio.
        return page.screenshot({ type: 'png', animations: 'disabled' });
      },
      Math.min(3, Math.max(1, size.scale ?? 2)),
    );
  }

  async close() {
    clearTimeout(this.#idle);
    const browser = await this.#browser?.catch(() => undefined);
    this.#browser = undefined;
    await browser?.close().catch(() => undefined);
  }
}

/**
 * The same picture at another scale, drawn by the browser itself (an `<img>`
 * of the first shot): no image library needed.
 */
async function shrink(page: Page, png: Buffer, width: number, height: number, scale: number) {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:#fff}img{display:block;width:${w}px;height:${h}px}</style></head><body><img src="data:image/png;base64,${png.toString('base64')}"></body></html>`,
    { waitUntil: 'load' },
  );
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, type: 'png', scale: 'css' });
}

/**
 * HTML to PDF and pictures, printed by a Chromium-family browser on this
 * computer (the one the browser feature uses, or the one it downloaded:
 * ADR 0014). It runs apart from the browsing profile, headless, with
 * JavaScript off and every request refused but `data:`, so a page prints
 * exactly what it says and reaches nothing (ADR 0034's seal, on paper).
 *
 * Without a browser it says so (`undefined`), and the makers fall back to
 * Conch's own writer: a PDF is never refused for want of Chrome.
 */
import { chromium, type Browser, type Page } from 'playwright-core';

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
  close(): Promise<void>;
}

const IDLE_MS = 60_000;
const TIMEOUT_MS = 30_000;

function footerTemplate(text: string | undefined): string {
  const words = (text ?? '')
    .slice(0, 120)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<div style="width:100%;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:7.5pt;color:#7a838c;padding:0 20mm;display:flex;justify-content:space-between;"><span>${words}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

export class ChromiumPrinter implements Printer {
  #browser?: Promise<Browser | undefined>;
  #name?: string;
  #idle?: NodeJS.Timeout;
  #busy = 0;

  constructor(
    private readonly deps: {
      /** Where the browsers are (tests hand in their own). */
      locate?: () => { name: string; path: string }[];
    } = {},
  ) {}

  by(): string | undefined {
    if (this.#name) return this.#name;
    const found = this.#candidates()[0];
    return found ? found.name.replace(/ \(downloaded by Conch\)$/, '') : undefined;
  }

  #candidates() {
    if (this.deps.locate) return this.deps.locate();
    return findBrowsers({
      downloaded: () => {
        try {
          return chromium.executablePath();
        } catch {
          return undefined;
        }
      },
    });
  }

  async #launch(): Promise<Browser | undefined> {
    for (const candidate of this.#candidates()) {
      try {
        const browser = await chromium.launch({
          executablePath: candidate.path,
          headless: true,
          timeout: TIMEOUT_MS,
          args: ['--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio'],
        });
        this.#name = candidate.name.replace(/ \(downloaded by Conch\)$/, '');
        browser.on('disconnected', () => {
          this.#browser = undefined;
        });
        return browser;
      } catch {
        // The next one, then Conch's own writer.
      }
    }
    return undefined;
  }

  async #page<T>(
    signal: AbortSignal | undefined,
    use: (page: Page) => Promise<T>,
    deviceScaleFactor = 1,
  ) {
    signal?.throwIfAborted();
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
      if (!this.#busy) {
        this.#idle = setTimeout(() => void this.close(), IDLE_MS);
        this.#idle.unref();
      }
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

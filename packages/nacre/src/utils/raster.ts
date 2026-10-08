/**
 * A card in the chat, as a picture — drawn by this browser, nothing else.
 *
 * Every card's share bar (`CardShare`) needs the same thing: the PNG a person
 * can save, copy or send to a chat app. Making it on the gateway would need a
 * headless browser (`file_make`'s PNG path does, and we don't require one), so
 * the page draws it itself: the card is serialised to a standalone SVG, that
 * SVG is drawn into a `<canvas>` at twice the size, and the canvas gives a PNG
 * `Blob`.
 *
 * Two kinds of card, one function:
 *
 * - **An `<svg>`** (a chart, a sparkline) is serialised directly, with every
 *   painted property written onto the element as an attribute, so nothing
 *   depends on a stylesheet that won't travel.
 * - **A DOM card** (the forecast) goes inside a `<foreignObject>` with the
 *   page's own CSS, the `--nc-*` tokens resolved to the values they have right
 *   now (so light and dark both come out right) and the fonts as `data:` URLs.
 *
 * What the browser won't draw inside an SVG image is dealt with before it can
 * come out blank: a picture from this origin becomes a `data:` URL, and a
 * frame, a canvas or a video (nothing a card has today) is dropped. Nothing is
 * fetched from another site, so an export can't be a way out for what the chat
 * read. An SVG image never loads a subresource, so even a remote address left
 * in the markup would draw nothing.
 */

/** Painted properties an `<svg>`'s elements carry over as attributes. */
const SVG_PAINT = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'visibility',
  'mix-blend-mode',
] as const;

/** Theme attributes the export carries, so rules that select on them still apply. */
const THEME_ATTRS = ['data-nacre-theme', 'data-nacre-mode', 'data-nacre-motion'];

/** How much taller than the page a DOM card is given room to be. */
const HEADROOM = 1.3;

/** How different a pixel has to be from the background to count as the card. */
const INK_TOLERANCE = 6;

/** What can't be drawn inside an SVG image: dropped rather than left blank. */
const UNDRAWABLE = 'iframe, canvas, video, audio, object, embed, script';

export interface CardImageOptions {
  /** Pixels per CSS pixel. 2 by default, for a crisp picture. */
  scale?: number;
  /**
   * The colour behind the card. By default the card's own surface colour, read
   * from the page (so a dark card stays dark), and `white` if it has none —
   * never transparent, which looks broken in a chat app.
   */
  background?: string;
  /** The picture's size in CSS pixels. By default the card's own. */
  width?: number;
  height?: number;
  /** Space around the card, in CSS pixels. */
  padding?: number;
  /**
   * Embed the page's fonts in the picture (the default). Without them the
   * export falls back to the system's own sans — readable, never missing.
   */
  fonts?: boolean;
}

/** A standalone SVG of `target`, and the size it was drawn at. */
export interface CardSvg {
  svg: string;
  /** CSS pixels. */
  width: number;
  height: number;
}

/** Thrown when a card can't be drawn, with a sentence a person can read. */
export class CardImageError extends Error {}

/**
 * The first opaque colour *behind* the card — its parent's, not its own. The
 * picture is then the card on the page's colour, as it looks in the chat, and
 * the card's own edge is visible against it. (It's also what lets the bottom
 * of the picture be trimmed back to the card: see `inkBottom`.)
 */
function opaqueBehind(element: Element): string | undefined {
  for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour && !/^(?:transparent|rgba?\([^)]*,\s*0(?:\.0+)?\))$/.test(colour)) return colour;
  }
  const body = document.body && getComputedStyle(document.body).backgroundColor;
  return body && !/^(?:transparent|rgba?\([^)]*,\s*0(?:\.0+)?\))$/.test(body) ? body : undefined;
}

/** Every `--nc-*` name any rule on the page mentions. */
function tokenNames(css: string): string[] {
  return [...new Set(css.match(/--nc-[a-z0-9-]+/g) ?? [])];
}

/**
 * The page's own CSS, as text. Only this origin's stylesheets can be read;
 * another site's throws and is skipped (there are none in Conch).
 */
function pageCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) parts.push(rule.cssText);
  }
  return parts.join('\n');
}

/** `url(…)` addresses in an `@font-face`, as they were written. */
function fontUrls(css: string): string[] {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const urls = new Set<string>();
  for (const face of faces)
    for (const match of face.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      const url = match[2];
      if (url && !url.startsWith('data:')) urls.add(url);
    }
  return [...urls];
}

/** One same-origin file as a `data:` URL; undefined when it can't be read. */
async function asDataUrl(url: string, limitBytes = 4 * 1024 * 1024): Promise<string | undefined> {
  let absolute: URL;
  try {
    absolute = new URL(url, document.baseURI);
  } catch {
    return undefined;
  }
  if (absolute.origin !== location.origin) return undefined;
  try {
    const response = await fetch(absolute.href);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (blob.size > limitBytes) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * The page's CSS with its fonts carried inside it. A font that can't be read
 * (offline, or a build that serves it from elsewhere) leaves its `@font-face`
 * behind: the export then falls back to the system's sans, which is why
 * `EXPORT_FALLBACK` is always appended.
 */
async function cssWithFonts(css: string): Promise<string> {
  const urls = fontUrls(css);
  if (!urls.length) return css;
  const embedded = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      const data = await asDataUrl(url);
      if (data) embedded.set(url, data);
    }),
  );
  if (!embedded.size) return stripFontFaces(css);
  let out = css;
  for (const [url, data] of embedded) out = out.split(url).join(data);
  // A face whose file didn't come would make the browser wait on nothing.
  return embedded.size === urls.length ? out : stripFontFaces(out, true);
}

/** Drop the `@font-face` rules that still point somewhere (nothing to load, no blank text). */
function stripFontFaces(css: string, onlyRemote = false): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (face) =>
    onlyRemote && !/url\((['"]?)(?!data:)/.test(face) ? face : '',
  );
}

/**
 * A browser draws an SVG image frozen at the first frame, so anything that
 * fades or falls in would come out invisible. Turning animation off instead
 * draws every element at the style it rests at — rain where it is, the sun's
 * rays still, a card's art there rather than half-arrived. `data-share-hide`
 * is how a card leaves its own share bar out of its picture.
 *
 * When a font couldn't be embedded its `@font-face` is dropped too, so the
 * family's next name (`ui-sans-serif`, `system-ui`) draws the text. Never a
 * missing glyph.
 */
const EXPORT_FALLBACK = `
.nc-export, .nc-export * {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}
.nc-export [data-share-hide] { display: none !important; }
`;

/** Resolve every token the page's CSS mentions to the value it has on `element`. */
function tokenStyle(element: Element, css: string): string {
  const computed = getComputedStyle(element);
  const out: string[] = [];
  for (const name of tokenNames(css)) {
    const value = computed.getPropertyValue(name).trim();
    if (value) out.push(`${name}: ${value}`);
  }
  return out.join('; ');
}

/** The theme attributes the page is wearing, for rules that select on them. */
function themeAttributes(): Record<string, string> {
  const root = document.documentElement;
  const out: Record<string, string> = {};
  for (const name of THEME_ATTRS) {
    const value = root.getAttribute(name);
    if (value !== null) out[name] = value;
  }
  // `data-nacre-mode` can say "system": the export needs the mode it really is.
  if (out['data-nacre-mode'] === 'system' || out['data-nacre-mode'] === undefined)
    out['data-nacre-mode'] = window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  out['data-nacre-theme'] ??= '';
  return out;
}

/** Write every painted property onto each element, so no stylesheet is needed. */
function inlineSvgPaint(original: SVGElement, clone: SVGElement) {
  const from = [original, ...Array.from(original.querySelectorAll<SVGElement>('*'))];
  const to = [clone, ...Array.from(clone.querySelectorAll<SVGElement>('*'))];
  for (const [i, node] of from.entries()) {
    const target = to[i];
    if (!target) continue;
    const computed = getComputedStyle(node);
    for (const property of SVG_PAINT) {
      const value = computed.getPropertyValue(property);
      if (!value || value === 'normal' || value === 'auto') continue;
      target.setAttribute(property, value);
    }
    target.removeAttribute('class');
    target.removeAttribute('style');
  }
}

/** Same-origin pictures inside a card, as `data:` URLs (an SVG image loads nothing). */
async function embedPictures(root: Element) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src');
      const data = src && !src.startsWith('data:') ? await asDataUrl(src) : src;
      if (data) img.setAttribute('src', data);
      else img.remove();
    }),
  );
}

/**
 * A `<style>` for the export. An SVG is XML, not HTML, so the CSS is text
 * that has to be escaped: `&` appears in nesting selectors and `<` in modern
 * media queries (`@media (width < 40rem)`), and either one unescaped makes
 * the whole picture fail to parse.
 */
function styleTag(css: string): string {
  const text = css.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<style type="text/css">${text}</style>`;
}

/** The SVG for one `<svg>` card. */
function svgOfSvg(target: SVGSVGElement, size: Size, options: CardImageOptions): string {
  const clone = target.cloneNode(true) as SVGSVGElement;
  inlineSvgPaint(target, clone);
  clone.querySelectorAll(UNDRAWABLE).forEach((node) => node.remove());
  // Read the attribute, not `viewBox.baseVal`: the same string either way, and
  // it's there before the SVG DOM is.
  const box = (target.getAttribute('viewBox') ?? '').trim();
  clone.setAttribute('viewBox', box || `0 0 ${size.width} ${size.height}`);
  clone.setAttribute('width', String(size.width));
  clone.setAttribute('height', String(size.height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const inner = new XMLSerializer().serializeToString(clone);
  const pad = options.padding ?? 0;
  const outer = { width: size.width + pad * 2, height: size.height + pad * 2 };
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${outer.width}" height="${outer.height}" viewBox="0 0 ${outer.width} ${outer.height}">`,
    `<rect width="100%" height="100%" fill="${escapeAttr(size.background)}"/>`,
    `<g transform="translate(${pad} ${pad})">${inner}</g>`,
    `</svg>`,
  ].join('');
}

/** The SVG for a DOM card: the card itself, inside a `<foreignObject>`. */
async function svgOfDom(
  target: HTMLElement,
  size: Size,
  options: CardImageOptions,
): Promise<CardSvg> {
  const clone = target.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(UNDRAWABLE).forEach((node) => node.remove());
  await embedPictures(clone);
  const raw = pageCss();
  const css =
    options.fonts === false
      ? `${stripFontFaces(raw)}\n${EXPORT_FALLBACK}`
      : `${await cssWithFonts(raw)}\n${EXPORT_FALLBACK}`;
  const attributes = themeAttributes();
  const wrapper = document.createElement('div');
  wrapper.className = 'nc-export';
  for (const [name, value] of Object.entries(attributes)) wrapper.setAttribute(name, value);
  const computed = getComputedStyle(target);
  wrapper.setAttribute(
    'style',
    [
      tokenStyle(target, raw),
      `box-sizing: border-box`,
      `width: ${size.width}px`,
      `color-scheme: ${attributes['data-nacre-mode'] === 'dark' ? 'dark' : 'light'}`,
      `color: ${computed.color}`,
      `background: ${size.background}`,
      `font-family: ${computed.fontFamily}`,
      `font-size: ${computed.fontSize}`,
      `line-height: ${computed.lineHeight}`,
    ].join('; '),
  );
  // A card measured in the page keeps that width: nothing reflows in the export.
  clone.style.width = `${size.width}px`;
  clone.style.margin = '0';
  wrapper.append(clone);

  // A `<foreignObject>` clips what doesn't fit, and says nothing about it. The
  // copy is measured as the copy (off to the side, with the export's own
  // rules), and then given room to spare: inside an SVG image a card lays out
  // a few percent taller than on the page, and a clipped card is the one
  // failure we refuse. The spare background is trimmed off the picture
  // afterwards (`inkBottom`), so nobody sees it.
  const height = Math.ceil(measureAside(wrapper, size.height) * HEADROOM) + 64;

  const body = new XMLSerializer().serializeToString(wrapper);
  const pad = options.padding ?? 0;
  const outer = { width: size.width + pad * 2, height: height + pad * 2 };
  return {
    width: outer.width,
    height: outer.height,
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${outer.width}" height="${outer.height}"`,
      ` viewBox="0 0 ${outer.width} ${outer.height}">`,
      `<rect width="100%" height="100%" fill="${escapeAttr(size.background)}"/>`,
      `<foreignObject x="${pad}" y="${pad}" width="${size.width}" height="${height}">`,
      `<div xmlns="http://www.w3.org/1999/xhtml">${styleTag(css)}${body}</div>`,
      `</foreignObject></svg>`,
    ].join(''),
  };
}

/**
 * How tall the export's own copy of a card really is. The copy goes into the
 * page out of sight (off to the inline-start, never `display: none`, which
 * measures nothing), with the export's rules applied, and comes straight back
 * out. `fallback` is used when the browser lays nothing out (a test).
 */
function measureAside(wrapper: HTMLElement, fallback: number): number {
  const hidden = document.createElement('div');
  hidden.setAttribute(
    'style',
    'position: fixed; inset-block-start: 0; inset-inline-start: -20000px;' +
      'inline-size: max-content; pointer-events: none; opacity: 0; z-index: -1;',
  );
  hidden.setAttribute('aria-hidden', 'true');
  // Measured with animation off, exactly as the picture will be drawn.
  const rules = document.createElement('style');
  rules.textContent = EXPORT_FALLBACK;
  hidden.append(rules, wrapper);
  document.body.append(hidden);
  try {
    const measured = Math.ceil(
      Math.max(wrapper.getBoundingClientRect().height, wrapper.scrollHeight),
    );
    return measured > 1 ? measured : fallback;
  } finally {
    // The wrapper goes back to being nobody's child, ready to be serialised.
    hidden.removeChild(wrapper);
    hidden.remove();
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

interface Size {
  width: number;
  height: number;
  background: string;
}

function measure(target: Element, options: CardImageOptions): Size {
  const box = target.getBoundingClientRect();
  const width = Math.max(1, Math.round(options.width ?? box.width));
  const height = Math.max(1, Math.round(options.height ?? box.height));
  const background = options.background ?? opaqueBehind(target) ?? '#ffffff';
  return { width, height, background };
}

/**
 * A card as one standalone SVG, with everything it needs inside it. Exported
 * for the tests and for anything that wants the vector rather than the PNG.
 */
export async function cardSvg(target: Element, options: CardImageOptions = {}): Promise<CardSvg> {
  if (typeof document === 'undefined')
    throw new CardImageError('A picture of a card can only be made in a browser.');
  const size = measure(target, options);
  if (size.width < 2 || size.height < 2)
    throw new CardImageError('That card isn’t on screen, so there’s nothing to make a picture of.');
  if (!(target instanceof SVGSVGElement)) return svgOfDom(target as HTMLElement, size, options);
  const pad = options.padding ?? 0;
  return {
    svg: svgOfSvg(target, size, options),
    width: size.width + pad * 2,
    height: size.height + pad * 2,
  };
}

/**
 * An SVG is XML, so one stray `&` or `<` in the markup makes the whole picture
 * fail to load with nothing said. When that happens, say what the parser
 * found: it's the difference between "didn't work" and a fixable line.
 */
function whyItWouldntParse(svg: string): string | undefined {
  try {
    const document_ = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const error = document_.querySelector('parsererror');
    return error?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return undefined;
  }
}

/**
 * The SVG as an image the canvas can draw, from a `data:` URL — not a `blob:`
 * one. They look interchangeable and aren't: Chrome treats an SVG image that
 * came from `URL.createObjectURL` and contains a `<foreignObject>` as
 * cross-origin, so the canvas is tainted and `toBlob` refuses. The same bytes
 * as a `data:` URL draw and read back fine. `img-src` allows both.
 */
function loadImage(svg: string): Promise<HTMLImageElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () => {
      const why = whyItWouldntParse(svg);
      reject(
        new CardImageError(
          why
            ? `This browser couldn’t draw that card as a picture: ${why}`
            : 'This browser couldn’t draw that card as a picture.',
        ),
      );
    };
    image.src = url;
  });
}

/**
 * The last row of pixels that isn't just the background, counting from the
 * bottom. That's where the card ends, whatever the browser decided its layout
 * came to inside the picture — so the spare room a DOM card is given can be
 * taken straight back off, and a card that drew nothing at all is caught
 * rather than saved as an empty rectangle.
 */
function inkBottom(context: CanvasRenderingContext2D, width: number, height: number): number {
  const { data } = context.getImageData(0, 0, width, height);
  const [r0, g0, b0] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const at = row + x * 4;
      if (
        Math.abs((data[at] ?? 0) - r0) > INK_TOLERANCE ||
        Math.abs((data[at + 1] ?? 0) - g0) > INK_TOLERANCE ||
        Math.abs((data[at + 2] ?? 0) - b0) > INK_TOLERANCE
      )
        return y + 1;
    }
  }
  return 0;
}

/**
 * A card as a PNG `Blob`, drawn at `scale` times its size on screen (2 by
 * default). Rejects with a `CardImageError` whose message is a sentence, so
 * the share bar can say what happened instead of saving something blank.
 */
export async function cardPng(target: Element, options: CardImageOptions = {}): Promise<Blob> {
  const { svg, width, height } = await cardSvg(target, options);
  const scale = Math.max(1, Math.min(4, options.scale ?? 2));
  const pad = options.padding ?? 0;
  const background = options.background ?? measure(target, options).background;
  const image = await loadImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new CardImageError('This browser couldn’t draw that card as a picture.');
  // The picture is opaque even if the card's own surface has a little
  // transparency: a see-through PNG looks broken in a chat app.
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.drawImage(image, 0, 0, width, height);
  context.setTransform(1, 0, 0, 1, 0, 0);

  const ink = inkBottom(context, canvas.width, canvas.height);
  if (!ink) throw new CardImageError('That card came out blank. Try again in a moment.');
  const wanted = Math.min(canvas.height, ink + Math.round(pad * scale));
  const trimmed = wanted < canvas.height ? crop(canvas, wanted, background) : canvas;

  const blob = await new Promise<Blob | null>((resolve) => trimmed.toBlob(resolve, 'image/png'));
  if (!blob?.size) throw new CardImageError('That card came out empty. Try again.');
  return blob;
}

/** The top `height` pixels of a canvas, on the same background. */
function crop(canvas: HTMLCanvasElement, height: number, background: string): HTMLCanvasElement {
  const cut = document.createElement('canvas');
  cut.width = canvas.width;
  cut.height = height;
  const context = cut.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = background;
  context.fillRect(0, 0, cut.width, cut.height);
  context.drawImage(canvas, 0, 0);
  return cut;
}

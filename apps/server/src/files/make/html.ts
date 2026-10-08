/**
 * Blocks as a finished, printable HTML page: the source of every PDF Conch
 * prints, and the `.html` it makes. Everything the model wrote is escaped;
 * the only pictures are the chat's own (as data URIs) and nothing is fetched.
 */
import type { Block, Run } from './blocks';

export type Theme = 'modern' | 'classic';
export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A5';

export interface PageOptions {
  title?: string;
  subtitle?: string;
  theme?: Theme;
  size?: PageSize;
  landscape?: boolean;
  /** `#rrggbb`: headings, rules and table heads. */
  accent?: string;
  /** Pictures by the `src` the document gave (`att_…`), as data URIs. */
  images?: ReadonlyMap<string, string>;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function imageSrc(src: string, images: ReadonlyMap<string, string> | undefined) {
  const found = images?.get(src);
  if (found) return found;
  return DATA_IMAGE.test(src) ? src : undefined;
}

function runs(list: readonly Run[], images?: ReadonlyMap<string, string>): string {
  return list
    .map((run) => {
      if (run.br) return '<br>';
      if (run.image) {
        const src = imageSrc(run.image.src, images);
        return src
          ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(run.image.alt)}">`
          : run.image.alt
            ? `<span class="missing">[${escapeHtml(run.image.alt)}]</span>`
            : '';
      }
      let html = escapeHtml(run.text);
      if (run.code) html = `<code>${html}</code>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.link) html = `<a href="${escapeHtml(run.link)}">${html}</a>`;
      return html;
    })
    .join('');
}

export function blocksHtml(doc: readonly Block[], images?: ReadonlyMap<string, string>): string {
  return doc
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `<h${block.level}>${runs(block.runs, images)}</h${block.level}>`;
        case 'paragraph': {
          const only = block.runs.length === 1 && block.runs[0]?.image;
          return `<p${only ? ' class="figure"' : ''}>${runs(block.runs, images)}</p>`;
        }
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
          const tasks = block.items.some((i) => i.checked !== undefined);
          return `<${tag}${start}${tasks ? ' class="tasks"' : ''}>${block.items
            .map(
              (item) =>
                `<li${item.checked === undefined ? '' : ` class="${item.checked ? 'done' : 'todo'}"`}>${runs(item.runs, images)}${blocksHtml(item.children, images)}</li>`,
            )
            .join('')}</${tag}>`;
        }
        case 'code':
          return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
        case 'quote':
          return `<blockquote>${blocksHtml(block.blocks, images)}</blockquote>`;
        case 'table': {
          const align = (i: number) => {
            const a = block.align[i];
            return a && a !== 'left' ? ` style="text-align:${a}"` : '';
          };
          const numeric = block.header.map(
            (_, i) =>
              block.rows.length > 0 &&
              block.rows.every((row) => /^[-+]?[$€£¥]?[\d.,]+%?$|^$/.test(rowText(row[i]))),
          );
          const cls = (i: number) => (numeric[i] && !block.align[i] ? ' class="num"' : '');
          return `<table><thead><tr>${block.header
            .map((cell, i) => `<th${align(i)}${cls(i)}>${runs(cell, images)}</th>`)
            .join('')}</tr></thead><tbody>${block.rows
            .map(
              (row) =>
                `<tr>${block.header.map((_, i) => `<td${align(i)}${cls(i)}>${runs(row[i] ?? [], images)}</td>`).join('')}</tr>`,
            )
            .join('')}</tbody></table>`;
        }
        case 'rule':
          return '<hr>';
        case 'pagebreak':
          return '<div class="page-break"></div>';
      }
      return '';
    })
    .join('\n');
}

function rowText(cell: readonly Run[] | undefined): string {
  return (cell ?? [])
    .map((r) => r.text)
    .join('')
    .trim();
}

const FONTS: Record<Theme, { body: string; heading: string }> = {
  modern: {
    body: '"Inter", "SF Pro Text", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    heading:
      '"Inter", "SF Pro Display", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  },
  classic: {
    body: '"Iowan Old Style", "Charter", "Palatino Linotype", Palatino, Georgia, Cambria, "Noto Serif", serif',
    heading:
      '"Avenir Next", "Segoe UI", -apple-system, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  },
};

export const ACCENT = '#1f5f8b';

export function accentOf(raw: string | undefined): string {
  return raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : ACCENT;
}

/** The page's CSS: print-first, with a screen look that matches the paper. */
export function pageCss(options: PageOptions): string {
  const fonts = FONTS[options.theme ?? 'modern'];
  const accent = accentOf(options.accent);
  const size = `${options.size ?? 'A4'}${options.landscape ? ' landscape' : ''}`;
  return `
@page { size: ${size}; margin: 22mm 20mm 24mm; }
:root { --accent: ${accent}; --ink: #1d2329; --soft: #59636e; --line: #d9dee3; --wash: #f4f6f8; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); font-family: ${fonts.body}; font-size: 10.5pt; line-height: 1.55;
  font-kerning: normal; font-variant-ligatures: common-ligatures; text-rendering: optimizeLegibility;
  hyphens: auto; orphans: 3; widows: 3; }
@media screen { body { max-width: 46rem; margin: 3rem auto; padding: 0 1.5rem; } }
h1, h2, h3, h4, h5, h6 { font-family: ${fonts.heading}; line-height: 1.2; color: var(--ink);
  break-after: avoid; page-break-after: avoid; margin: 1.6em 0 0.5em; letter-spacing: -0.01em; }
h1 { font-size: 22pt; font-weight: 700; margin-top: 0; letter-spacing: -0.02em; }
h2 { font-size: 15pt; font-weight: 650; padding-bottom: 0.25em; border-bottom: 1.5px solid var(--accent); }
h3 { font-size: 12.5pt; font-weight: 650; color: var(--accent); }
h4 { font-size: 11pt; font-weight: 650; }
h5, h6 { font-size: 10.5pt; font-weight: 650; color: var(--soft); text-transform: uppercase; letter-spacing: 0.04em; }
p { margin: 0 0 0.75em; }
a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 0.06em; text-underline-offset: 0.15em; }
strong { font-weight: 650; }
code { font-family: "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.88em;
  background: var(--wash); border-radius: 3px; padding: 0.08em 0.3em; }
pre { background: var(--wash); border: 1px solid var(--line); border-radius: 6px; padding: 0.8em 1em;
  white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; margin: 0 0 1em; line-height: 1.45; }
pre code { background: none; padding: 0; font-size: 8.8pt; }
blockquote { margin: 0 0 1em; padding: 0.2em 0 0.2em 1em; border-left: 3px solid var(--accent); color: var(--soft); }
ul, ol { margin: 0 0 0.85em; padding-left: 1.4em; }
li { margin: 0.2em 0; }
li > ul, li > ol { margin: 0.2em 0; }
ul.tasks { list-style: none; padding-left: 0.2em; }
ul.tasks li::before { content: "☐"; margin-right: 0.5em; color: var(--soft); }
ul.tasks li.done::before { content: "☑"; color: var(--accent); }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.6em 0; }
table { width: 100%; border-collapse: collapse; margin: 0.4em 0 1.2em; font-size: 9.5pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; font-family: ${fonts.heading}; font-weight: 650; color: var(--ink);
  border-bottom: 1.5px solid var(--accent); padding: 0.45em 0.6em; }
td { border-bottom: 1px solid var(--line); padding: 0.4em 0.6em; vertical-align: top; }
tbody tr:nth-child(even) td { background: #fafbfc; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
img { max-width: 100%; height: auto; border-radius: 4px; }
p.figure { text-align: center; margin: 1em 0; break-inside: avoid; }
.missing { color: var(--soft); font-style: italic; }
.page-break { break-after: page; page-break-after: always; }
header.title { margin: 0 0 1.8em; padding-bottom: 1em; border-bottom: 1px solid var(--line); }
header.title h1 { margin: 0 0 0.2em; font-size: 26pt; }
header.title p { margin: 0; color: var(--soft); font-size: 12pt; }
`;
}

/**
 * The whole page. A strict CSP is part of it, so even opened from disk the
 * file runs nothing and loads nothing but its own pictures.
 */
export function documentHtml(doc: readonly Block[], options: PageOptions): string {
  const title = options.title?.trim();
  const head =
    title && !(doc[0]?.type === 'heading' && doc[0].level === 1)
      ? `<header class="title"><h1>${escapeHtml(title)}</h1>${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ''}</header>`
      : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'Document')}</title>
<style>${pageCss(options)}</style>
</head>
<body>
${head}
${blocksHtml(doc, options.images)}
</body>
</html>
`;
}

/**
 * An HTML page the model wrote itself, made safe to print: scripts, frames,
 * forms and outside resources removed, and the same CSP. Chromium prints it
 * with JavaScript off and the network cut, so this is a second wall.
 */
export function sealHtml(html: string): string {
  let out = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<(iframe|frame|frameset|object|embed|form|base|link|meta)\b[^>]*>/gi, '')
    .replace(/<\/(iframe|frame|frameset|object|embed|form)\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi,
      '$1="#"',
    );
  const csp =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:">';
  out = /<head\b[^>]*>/i.test(out)
    ? out.replace(/<head\b[^>]*>/i, (head) => `${head}<meta charset="utf-8">${csp}`)
    : `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body>${out}</body></html>`;
  return out;
}

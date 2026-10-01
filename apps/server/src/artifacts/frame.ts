/**
 * A page the assistant made, run sealed off (ADR 0034).
 *
 * The page is HTML and JavaScript a model wrote — possibly a model that read
 * something hostile — so it runs as if it came from nowhere:
 *
 * - **An opaque origin.** The iframe is `sandbox="allow-scripts"` with no
 *   `allow-same-origin`, and the response says `sandbox allow-scripts` itself,
 *   so even opened on its own it is nobody's origin: no cookies, no storage,
 *   no Conch API, no reaching into the page that shows it.
 * - **No network.** `connect-src 'none'`, and images, fonts and media only
 *   from `data:`/`blob:`: nothing can be fetched, and nothing can leave in
 *   the address of an image or a font (the classic markdown-image leak).
 * - **No way out.** No popups, no top navigation, no forms. What CSP can't
 *   stop — a script sending its own frame to another address — is why a page
 *   that tries is opened with its scripts off until you say it may run them
 *   (`navigates`), and why the panel stops a frame that navigates anyway.
 *
 * The only things it can say to Conch are its height and "open this link" (which
 * Conch asks you about first), by `postMessage`, which the panel checks comes
 * from that very frame. With its code off, links have nowhere to go: they'd
 * open a new tab, and a sealed page can't.
 */

/** Anything in a page that can send you (and what it knows) to another address. */
const NAVIGATES = [
  /\blocation\s*(?:\.\s*(?:href|assign|replace)\b|=|\[)/i,
  /\bwindow\s*\.\s*open\s*\(/i,
  /\b(?:top|parent|opener)\s*\./i,
  /<\s*form\b/i,
  /<\s*meta[^>]+http-equiv\s*=\s*["']?refresh/i,
  /<\s*a\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/|javascript:)/i,
  /<\s*(?:iframe|frame|object|embed)\b/i,
  /\.\s*(?:click|submit)\s*\(\s*\)/i,
];

export function navigates(html: string): boolean {
  return NAVIGATES.some((pattern) => pattern.test(html));
}

/** The response headers for a sealed page. `scripts: false` runs none at all. */
export function frameHeaders(scripts: boolean): Record<string, string> {
  const csp = [
    "default-src 'none'",
    `script-src ${scripts ? "'unsafe-inline'" : "'none'"}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "frame-ancestors 'self'",
    scripts ? 'sandbox allow-scripts' : 'sandbox',
  ].join('; ');
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': csp,
    'content-disposition': 'inline; filename="artifact.html"',
    'x-content-type-options': 'nosniff',
    // Shown inside Conch only: in a frame of the same origin, never elsewhere.
    'x-frame-options': 'SAMEORIGIN',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), display-capture=()',
    'cache-control': 'no-store',
  };
}

/** Plain text in HTML. */
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * The page itself: the artifact's HTML with Conch's colours as defaults (the
 * page's own styles win) and a few lines that tell the panel its height.
 * A fragment gets a whole document around it; a whole document keeps its own.
 */
export function frameDocument(
  html: string,
  options: { title: string; theme: 'light' | 'dark'; parentOrigin: string },
): string {
  const base = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${options.theme}">
<base target="_blank">
<style>
:root { color-scheme: ${options.theme}; }
html { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
body { margin: 16px; background: ${options.theme === 'dark' ? '#16120f' : '#fffdfb'}; color: ${options.theme === 'dark' ? '#efe8e3' : '#2b2522'}; }
</style>`;
  // Inline so it runs with `script-src 'unsafe-inline'`; harmless when scripts are off.
  // A link out never navigates the page: Conch asks you, then opens it in a tab of its own.
  // In the head, so it's listening before any of the page's own code runs.
  const bridge = `<script>(function(){var o=${JSON.stringify(options.parentOrigin)};function p(m){try{m.conch='artifact';parent.postMessage(m,o)}catch(e){}}function s(){p({height:Math.ceil(document.documentElement.scrollHeight)})}addEventListener('load',s);if(typeof ResizeObserver==='function')new ResizeObserver(s).observe(document.documentElement);s();document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';if(h.charAt(0)==='#')return;e.preventDefault();if(/^https?:/i.test(a.href))p({open:a.href})},true);})();</script>`;
  const whole = /<\s*html[\s>]/i.test(html);
  if (!whole)
    return `<!doctype html><html lang="en"><head>${base}${bridge}<title>${escape(options.title)}</title></head><body>${html}</body></html>`;
  return /<\s*head[\s>]/i.test(html)
    ? html.replace(/<\s*head(\s[^>]*)?>/i, (m) => `${m}${base}${bridge}`)
    : html.replace(/<\s*html(\s[^>]*)?>/i, (m) => `${m}<head>${base}${bridge}</head>`);
}

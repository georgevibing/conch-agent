import { PAGE_DATA_BRIDGE } from '../conchapps/page-bridge';
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
 * The only things it can say to Conch are its height, "open this link" (which
 * Conch asks you about first) and "read this source I declared" (ADR 0046:
 * the gateway reads it, if you said it may), by `postMessage`, which the
 * panel checks comes from that very frame. With its code off, links have nowhere to go: they'd
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
 *
 * A Conch app's page (ADR 0061) also gets the Nacre page kit (`kit`) before
 * its own styles, the person's `accent`, and `conch.call(tool, input)`: the
 * frame asks the panel (`{conch:'artifact', call}`), which asks the gateway
 * for that app's own tools, and the answer is believed only from the panel.
 */
export function frameDocument(
  html: string,
  options: {
    title: string;
    theme: 'light' | 'dark';
    parentOrigin: string;
    /** The page kit's CSS, before the page's own styles. */
    kit?: string;
    /** The person's accent: a Nacre accent name or a hex colour. */
    accent?: string;
    /** Add `conch.call` for a Conch app's page. */
    calls?: boolean;
  },
): string {
  // The kit is Conch's own CSS; still, nothing in it can close the style early.
  const kit =
    options.kit === undefined ? '' : `<style>${options.kit.replaceAll('</', '<\\/')}</style>`;
  const base = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${options.theme}">
<base target="_blank">
<style>
:root { color-scheme: ${options.theme}; }
html { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
body { margin: 16px; background: ${options.theme === 'dark' ? '#16120f' : '#fffdfb'}; color: ${options.theme === 'dark' ? '#efe8e3' : '#2b2522'}; }
</style>${kit}`;
  // A Conch app's page calls its own tools (ADR 0061): only with `calls`, so an artifact's page is as it was.
  const calls = options.calls === true;
  const callVars = calls ? ',v={}' : '';
  const callFn = calls
    ? "function q(t,x){return new Promise(function(f){var id='c'+(++n);v[id]=f;p({call:{id:id,tool:String(t),input:x||{}}})})}"
    : '';
  const callMsg = calls
    ? "if(m&&m.conch==='app-call'){var g=v[m.id];if(g){delete v[m.id];g(m.result||{ok:false,reason:'error',message:'Conch didn’t answer.'})}return}"
    : '';
  const callApi = calls ? ',call:q,state:state,query:query,observe:observe' : '';
  const pageDataBridge = calls ? PAGE_DATA_BRIDGE : '';
  const refreshQueries = calls ? 'refreshQueries();' : '';
  // Inline so it runs with `script-src 'unsafe-inline'`; harmless when scripts are off.
  // A link out never navigates the page: Conch asks you, then opens it in a tab of its own.
  // Live data (ADR 0046): `conch.data(name, params)` asks the panel, which asks the
  // gateway; answers are believed only from the panel (`source` and `origin`).
  // In the head, so it's listening before any of the page's own code runs.
  // JSON quoting protects JavaScript; escaping '<' also protects the HTML script boundary.
  const parentOrigin = JSON.stringify(options.parentOrigin).replaceAll('<', '\\u003c');
  const bridge = `<script>(function(){var o=${parentOrigin},n=0,w={},k=[]${callVars};function p(m){try{m.conch='artifact';parent.postMessage(m,o)}catch(e){}}function s(){p({height:Math.ceil(document.documentElement.scrollHeight)})}addEventListener('load',s);if(typeof ResizeObserver==='function')new ResizeObserver(s).observe(document.documentElement);s();document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';if(h.charAt(0)==='#')return;e.preventDefault();if(/^https?:/i.test(a.href))p({open:a.href})},true);function r(x){x=x||{};var g=x.ok===true&&x.status>=200&&x.status<300;return{ok:g,status:x.status||0,at:x.at||0,text:typeof x.body==='string'?x.body:'',reason:x.reason||(g?'':'status'),message:x.message||(g?'':'The site answered with an error ('+x.status+').'),json:function(){return JSON.parse(this.text)}}}function d(source,params){return new Promise(function(f){var id='d'+(++n);w[id]=f;p({data:{id:id,source:String(source),params:params||{}}})})}${callFn}${pageDataBridge}function c(f,x){try{f(x)}catch(e){}}addEventListener('message',function(e){if(e.source!==parent||e.origin!==o)return;var m=e.data;${callMsg}if(!m||m.conch!=='artifact-data')return;if(m.refresh){${refreshQueries}k.forEach(function(q){d(q.s,q.p).then(function(x){c(q.f,x)})});return}var f=w[m.id];if(!f)return;delete w[m.id];f(r(m.result))});window.conch=Object.freeze({data:d,watch:function(source,params,f){k.push({s:source,p:params,f:f});d(source,params).then(function(x){c(f,x)})}${callApi}});})();</script>`;
  // An app page's theme and accent, for the page kit's selectors.
  const accent =
    options.accent && /^(?:[a-z][a-z-]{0,19}|#[0-9a-f]{6})$/i.test(options.accent)
      ? options.accent
      : undefined;
  const attrs =
    options.kit === undefined && !accent
      ? ''
      : ` data-theme="${options.theme}"${accent ? ` data-accent="${escape(accent)}"` : ''}`;
  const whole = /<\s*html[\s>]/i.test(html);
  if (!whole)
    return `<!doctype html><html lang="en"${attrs}><head>${base}${bridge}<title>${escape(options.title)}</title></head><body>${html}</body></html>`;
  const tagged = attrs ? html.replace(/<\s*html(?=[\s>])/i, (m) => `${m}${attrs}`) : html;
  return /<\s*head[\s>]/i.test(tagged)
    ? tagged.replace(/<\s*head(\s[^>]*)?>/i, (m) => `${m}${base}${bridge}`)
    : tagged.replace(/<\s*html(\s[^>]*)?>/i, (m) => `${m}<head>${base}${bridge}</head>`);
}

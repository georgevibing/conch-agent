/**
 * What the window may do (ADR 0054), as pure functions so every rule is
 * tested. From Electron's security checklist: the window stays on Conch's
 * own origin, every other link goes to the person's browser (and only web
 * and mail links do), sign-ins happen in the person's browser, and only the
 * permissions Conch uses are granted, only to Conch.
 */

/** `http://127.0.0.1:4317`, or undefined for anything that isn't a URL. */
export function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? undefined : parsed.origin;
  } catch {
    return undefined;
  }
}

/** The window may show `url`: it's on one of Conch's origins (the gateway, or the web dev server). */
export function isConch(url: string, origins: readonly string[]): boolean {
  const origin = originOf(url);
  return origin !== undefined && origins.includes(origin);
}

/**
 * A link to hand to the person's browser or mail app, or undefined. Never a
 * file, a custom scheme or a script: those would run something on this
 * computer.
 */
export function externalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    )
      return parsed.href;
  } catch {
    // Not a link.
  }
  return undefined;
}

/** The pages the gateway sends a sign-in back to (`display: 'popup'`). */
const DONE_PAGES = new Set(['/integrations/done', '/providers/done']);

/**
 * A sign-in window the page opens: Conch's own "opening…" page (or a blank
 * one, for Google) that the page then sends to the provider. The app creates
 * it hidden and hands the provider's address to the person's browser.
 */
export function isSignInWindow(
  url: string,
  frameName: string,
  origins: readonly string[],
): boolean {
  if (url === 'about:blank') return frameName.startsWith('conch-');
  if (!isConch(url, origins)) return false;
  return DONE_PAGES.has(new URL(url).pathname);
}

/**
 * The app's own pages are served from a scheme of its own (Electron's advice,
 * instead of `file:`): `conch-app://app/status.html`.
 */
export const APP_SCHEME = 'conch-app';
export const STATUS_PAGE = `${APP_SCHEME}://app/status.html`;

/** The app's own file a `conch-app:` address asks for, if it's one it serves. Nothing else, ever. */
export function appFile(url: string): 'status.html' | 'status.js' | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== 'app') return undefined;
    const name = parsed.pathname.slice(1);
    return name === 'status.html' || name === 'status.js' ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A button on the app's own status page: its links are `#retry`, `#log`
 * and `#quit`. Nothing on any other page counts.
 */
export function appAction(url: string): 'retry' | 'log' | 'quit' | undefined {
  try {
    const parsed = new URL(url);
    if (appFile(url) !== 'status.html') return undefined;
    const match = /^#(retry|log|quit)$/.exec(parsed.hash);
    return (match?.[1] as 'retry' | 'log' | 'quit' | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/** What Conch's pages use: notifications, the microphone for voice, the clipboard, full screen. */
const ALLOWED = new Set([
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
]);

/**
 * Grant `permission` to the page at `url`? Only Conch's own origins, only
 * what Conch uses, and for media only the microphone (voice never needs the
 * camera or the screen).
 */
export function allowPermission(
  permission: string,
  url: string,
  origins: readonly string[],
  mediaTypes: readonly string[] = [],
): boolean {
  if (!isConch(url, origins) || !ALLOWED.has(permission)) return false;
  if (permission === 'media')
    return mediaTypes.length > 0 && mediaTypes.every((t) => t === 'audio');
  return true;
}

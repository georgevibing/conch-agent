/**
 * What the assistant may touch on your computer (ADR 0110), as pure rules:
 * the apps it never touches, the key presses it never makes, and how a
 * picture of the screen maps back to the screen. The tools ask these; the
 * driver only does what they allowed.
 */

/** An app as macOS names it: its bundle identifier (or its name, where it has none) and its name. */
export interface ScreenApp {
  id: string;
  name: string;
}

/** A rectangle on the screen, in points (or in a picture's pixels, where said). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface KeptAway {
  /** A few words, as Settings lists them. */
  label: string;
  /** Why, in a sentence the assistant reads. */
  why: string;
  ids: readonly string[];
  /** Names (and bundle ids) that mean this kind of app. */
  names: RegExp;
}

/**
 * The apps it never touches, whatever the chat says, in every mode. The
 * screen picture covers their windows too, so it never reads them either.
 * Banking can't be listed app by app; the names catch the common ones and
 * the websites stay with the browser's own rules (ADR 0014).
 */
const KEPT_AWAY: readonly KeptAway[] = [
  {
    label: 'Conch itself',
    why: 'Conch never uses its own window: its questions are yours to answer.',
    // The app, and the same app run from the repository (`pnpm desktop:dev`).
    ids: ['com.conchagent.app', 'com.github.Electron'],
    names: /^Conch$/i,
  },
  {
    label: 'Password managers',
    why: 'Passwords stay with you. When a sign-in needs one, ask the person to do that part, or use Passwords (passwords_find).',
    ids: [
      'com.1password.1password',
      'com.agilebits.onepassword7',
      'com.bitwarden.desktop',
      'org.keepassxc.keepassxc',
      'com.dashlane.dashlanephonefinal',
      'com.callpod.keepermac',
      'me.proton.pass.electron',
      'com.lastpass.lastpassmacdesktop',
      'in.sinew.Enpass-Desktop',
      'com.apple.keychainaccess',
      'com.apple.Passwords',
    ],
    names:
      /\b(1Password|Bitwarden|KeePass\w*|Dashlane|Keeper|Proton Pass|LastPass|Enpass|RoboForm|NordPass|Keychain Access|Passwords)\b/i,
  },
  {
    label: 'System Settings and security prompts',
    why: 'Changing how the computer is set up, and answering its password and permission prompts, is the person’s to do.',
    ids: [
      'com.apple.systempreferences',
      'com.apple.SecurityAgent',
      'com.apple.LocalAuthentication.UIAgent',
      'com.apple.coreautha',
      'com.apple.loginwindow',
      'com.apple.UserNotificationCenter',
      'com.apple.Spotlight',
      'com.apple.DiskUtility',
      'com.apple.MigrateAssistant',
      'com.apple.BootCampAssistant',
    ],
    names:
      /^(System Settings|System Preferences|SecurityAgent|coreautha|loginwindow|UserNotificationCenter|Spotlight|Disk Utility|Migration Assistant|Boot Camp Assistant|Installer)$/i,
  },
  {
    label: 'Terminals',
    why: 'Commands go through Conch’s own command tool, where the person’s rules about commands apply. Run it there instead.',
    ids: [
      'com.apple.Terminal',
      'com.googlecode.iterm2',
      'com.mitchellh.ghostty',
      'dev.warp.Warp-Stable',
      'net.kovidgoyal.kitty',
      'org.alacritty',
      'co.zeit.hyper',
      'com.github.wez.wezterm',
      'com.apple.ScriptEditor2',
      'com.apple.Automator',
    ],
    names:
      /^(Terminal|iTerm2?|Ghostty|Warp|kitty|Alacritty|Hyper|WezTerm|Script Editor|Automator)$/i,
  },
  {
    label: 'Banking, payments and crypto',
    why: 'Moving money is the person’s to do. Tell them what to do there instead.',
    ids: [
      'com.paypal.PayPal',
      'com.venmo.touch',
      'com.transferwise.Wise',
      'com.revolut.revolut',
      'com.coinbase.Coinbase',
      'com.ledger.live',
      'com.exodus.exodus',
      'com.robinhood.release.Robinhood',
      'com.monzo.Monzo',
      'com.n26.N26',
    ],
    names:
      /\b(bank|banking|PayPal|Venmo|Wise|Revolut|Coinbase|Ledger Live|Exodus|Robinhood|Monzo|N26|Binance|Kraken|MetaMask|wallet|crypto|brokerage|Fidelity|Schwab|Vanguard)\b/i,
  },
];

/** Browsers: Conch in a tab of one is Conch itself. */
const BROWSERS =
  /^(Safari|Google Chrome|Chrome|Chromium|Microsoft Edge|Brave Browser|Firefox|Arc|Opera|Vivaldi|Orion|Zen)$/i;
/** The title Conch's own page gives its tab: `Conch`, or `Something · Conch`. */
const CONCH_TITLE = /(^|\s·\s)Conch(\s[-–—]\s.*)?$/;

/** The kinds of app it never touches, for Settings. */
export const KEPT_AWAY_LABELS: readonly string[] = KEPT_AWAY.map((k) => k.label);

/**
 * Why this app is kept from the assistant, or undefined when it may be asked
 * about. `title`: the window's own title, when known (Conch in a browser tab).
 */
export function keptAway(
  app: ScreenApp,
  title?: string,
): { label: string; why: string } | undefined {
  if (BROWSERS.test(app.name) && title && CONCH_TITLE.test(title.trim()))
    return { label: KEPT_AWAY[0]?.label ?? 'Conch itself', why: KEPT_AWAY[0]?.why ?? '' };
  for (const kind of KEPT_AWAY)
    if (kind.ids.includes(app.id) || kind.names.test(app.name)) return kind;
  return undefined;
}

// ── Keys ─────────────────────────────────────────────────────────────────

export type Modifier = 'cmd' | 'ctrl' | 'alt' | 'shift' | 'fn';

/** A key press: modifiers held, then one key, by its macOS key code. */
export interface KeyCombo {
  modifiers: Modifier[];
  /** The key's virtual key code on a US keyboard. */
  code: number;
  /** How it was written, tidied: `cmd+shift+t`. */
  label: string;
}

const MODIFIERS: Record<string, Modifier> = {
  cmd: 'cmd',
  command: 'cmd',
  super: 'cmd',
  meta: 'cmd',
  win: 'cmd',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  fn: 'fn',
};

/** macOS virtual key codes (ANSI layout), by the names models write. */
const CODES: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  '=': 24,
  '9': 25,
  '7': 26,
  '-': 27,
  '8': 28,
  '0': 29,
  ']': 30,
  o: 31,
  u: 32,
  '[': 33,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ';': 41,
  '\\': 42,
  ',': 43,
  '/': 44,
  n: 45,
  m: 46,
  '.': 47,
  '`': 50,
  return: 36,
  enter: 36,
  kpenter: 76,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 51,
  forwarddelete: 117,
  escape: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  prior: 116,
  next: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  help: 114,
  minus: 27,
  equal: 24,
  plus: 24,
  comma: 43,
  period: 47,
  slash: 44,
  semicolon: 41,
  apostrophe: 39,
  quote: 39,
  grave: 50,
  backslash: 42,
  bracketleft: 33,
  bracketright: 30,
};

/** The xdotool names models trained on Anthropic's tool write (`Return`, `Page_Down`, `BackSpace`). */
const ALIASES: Record<string, string> = {
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  del: 'forwarddelete',
  'forward delete': 'forwarddelete',
  esc: 'escape',
  pgup: 'pageup',
  pgdn: 'pagedown',
  ret: 'return',
  spacebar: 'space',
};

/** `cmd+shift+t`, `ctrl+s`, `Return`, `super+space`: a combo, or a sentence saying what's wrong. */
export function parseKeys(text: string): KeyCombo | string {
  const parts = text
    .trim()
    .split(/\s*\+\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return 'Say which key, like "Return" or "cmd+s".';
  if (parts.length > 5) return 'Press one key at a time, with at most four keys held.';
  const modifiers: Modifier[] = [];
  let code: number | undefined;
  let keyName = '';
  for (const [i, raw] of parts.entries()) {
    const word = raw.toLowerCase();
    const mod = MODIFIERS[word.replace(/_[lr]$/, '').replace(/^(left|right)_?/, '')];
    if (mod && i < parts.length - 1) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
      continue;
    }
    if (i !== parts.length - 1)
      return `“${raw}” isn’t a key to hold. Hold cmd, ctrl, alt or shift.`;
    const name = ALIASES[word] ?? word.replace(/[\s_]+/g, word.length > 1 ? '' : ' ');
    code = CODES[name] ?? CODES[word];
    keyName = name;
    if (code === undefined)
      return `“${raw}” isn’t a key Conch knows. Use names like Return, Tab, Escape, Left, Page_Down, F5, or a letter.`;
  }
  if (code === undefined) return 'Say which key, like "Return" or "cmd+s".';
  const order: Modifier[] = ['ctrl', 'alt', 'shift', 'cmd', 'fn'];
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { modifiers, code, label: [...modifiers, keyName].join('+') };
}

/** The keys that stop the assistant (ADR 0110): the person's, never pressed for them. */
export const STOP_KEYS = { mac: '⌘⎋', accelerator: 'CommandOrControl+Escape' } as const;

/**
 * Key presses it never makes, whatever app is in front: they end your
 * session, empty the bin, force things to quit, open Spotlight (open_app
 * does that, with the rules), or are your Stop keys.
 */
export function refusedKeys(combo: KeyCombo): string | undefined {
  const has = (...mods: Modifier[]) =>
    mods.every((m) => combo.modifiers.includes(m)) && combo.modifiers.length === mods.length;
  const key = combo.code;
  if (key === CODES.escape && has('cmd'))
    return 'cmd+Escape is the person’s Stop keys. Don’t press it.';
  if (key === CODES.q && (has('ctrl', 'cmd') || has('shift', 'cmd') || has('alt', 'shift', 'cmd')))
    return 'That locks the screen or signs the person out. Don’t.';
  if (key === CODES.escape && has('alt', 'cmd'))
    return 'That opens Force Quit. Ask the person if something needs quitting.';
  if (key === CODES.delete && (has('shift', 'cmd') || has('alt', 'shift', 'cmd')))
    return 'That empties the Bin, which can’t be undone. Ask the person to do it.';
  if (key === CODES.delete && has('alt', 'cmd'))
    return 'That deletes for good, skipping the Bin. Ask the person to do it.';
  if (key === CODES.space && (has('cmd') || has('ctrl')))
    return 'Use open_app to open an app instead of Spotlight.';
  return undefined;
}

// ── The picture and the screen ───────────────────────────────────────────

/**
 * The largest picture to send: about a megapixel, which every model that
 * sees reads well, and Anthropic's own advice for computer use (1280×800).
 */
export const PICTURE_MAX = { width: 1280, height: 800 } as const;

/** The picture's size for a screen of `width`×`height` points, and how much smaller it is. */
export function fitPicture(
  width: number,
  height: number,
  max: { width: number; height: number } = PICTURE_MAX,
): { width: number; height: number; scale: number } {
  const scale = Math.min(1, max.width / width, max.height / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** A point in the picture, as a point on the screen; undefined when it's off the picture. */
export function toScreen(
  x: number,
  y: number,
  picture: { width: number; height: number; scale: number },
): { x: number; y: number } | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (x < 0 || y < 0 || x > picture.width || y > picture.height) return undefined;
  return { x: Math.round(x / picture.scale), y: Math.round(y / picture.scale) };
}

/** A rectangle on the screen, in the picture's pixels, clipped to it. */
export function toPicture(
  rect: Rect,
  picture: { width: number; height: number; scale: number },
): Rect | undefined {
  const x = Math.max(0, Math.floor(rect.x * picture.scale));
  const y = Math.max(0, Math.floor(rect.y * picture.scale));
  const right = Math.min(picture.width, Math.ceil((rect.x + rect.width) * picture.scale));
  const bottom = Math.min(picture.height, Math.ceil((rect.y + rect.height) * picture.scale));
  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

/** Steps on the computer one turn may take before it stops to check in with the person. */
export const MAX_STEPS = 60;

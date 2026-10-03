/**
 * The terminal kit every `conch` command talks through.
 *
 * It works out what this terminal can show (colour depth, Unicode, links,
 * whether it may animate) once, then draws Conch's pieces in Nacre's colours:
 * lines indented two spaces, steps that turn into ✓ in place, a rounded card
 * for the one thing you need (a link, a code), commands to copy, QR codes.
 *
 * It always degrades instead of breaking: 256 colours approximate truecolor,
 * 16 colours use the terminal's own palette, and with no colour, no TTY or a
 * `dumb` terminal it's plain text with no cursor tricks, safe to pipe into a
 * log. All output goes through one injectable stream, so tests read it back.
 */
import { release } from 'node:os';

import { renderUnicodeCompact } from 'uqr';

// ── What this terminal can do ────────────────────────────────────────────

export type ColorDepth = 'none' | '16' | '256' | 'truecolor';

export interface Term {
  /** A person is looking at it (not a pipe or a file). */
  tty: boolean;
  color: ColorDepth;
  /** Box drawing, ✓, ●… (otherwise ASCII stand-ins). */
  unicode: boolean;
  /** OSC 8: words that open a link when clicked. */
  hyperlinks: boolean;
  /** Redrawing in place is safe (spinners, the shimmering pearl). */
  animate: boolean;
  columns: number;
}

/** Where output goes: `process.stdout`, or a test's capture. */
export interface Out {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

type Env = Record<string, string | undefined>;

function forced(env: Env): ColorDepth | undefined {
  const value = env.FORCE_COLOR;
  if (value === undefined) return undefined;
  if (value === '0' || value === 'false') return 'none';
  if (value === '2') return '256';
  if (value === '3') return 'truecolor';
  return '16';
}

function depth(env: Env, tty: boolean, platform: NodeJS.Platform, osRelease: string): ColorDepth {
  if (env.NO_COLOR) return 'none';
  const force = forced(env);
  if (force) return force;
  if (!tty || env.TERM === 'dumb') return 'none';
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 'truecolor';
  if (env.WT_SESSION || env.KITTY_WINDOW_ID) return 'truecolor';
  if (/^(iTerm\.app|WezTerm|vscode|ghostty|Hyper|Tabby|rio)$/.test(env.TERM_PROGRAM ?? ''))
    return 'truecolor';
  if (env.CI) return '16';
  if (platform === 'win32') {
    // Windows 10 1607 (build 14931) and later draw 24-bit colour in the console.
    const build = Number(osRelease.split('.')[2] ?? 0);
    return build >= 14931 ? 'truecolor' : build >= 10586 ? '256' : '16';
  }
  if (/-256(color)?$/i.test(env.TERM ?? '') || env.TERM_PROGRAM === 'Apple_Terminal') return '256';
  return '16';
}

/** Read what `out` (and the environment) can show. Pure: pass anything for tests. */
export function detectTerm(
  out: Out = process.stdout,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
): Term {
  const tty = Boolean(out.isTTY) && env.TERM !== 'dumb';
  const color = depth(env, tty, platform, osRelease);
  // The Linux console and the old Windows console can't draw much beyond ASCII.
  const unicode =
    env.TERM !== 'linux' &&
    !(platform === 'win32' && !env.WT_SESSION && !env.TERM_PROGRAM && !env.ConEmuANSI);
  const hyperlinks =
    tty &&
    !env.CI &&
    Boolean(
      env.WT_SESSION ||
      env.KITTY_WINDOW_ID ||
      /^(iTerm\.app|WezTerm|vscode|ghostty|Hyper|Tabby|rio)$/.test(env.TERM_PROGRAM ?? '') ||
      Number(env.VTE_VERSION ?? 0) >= 5000,
    );
  return {
    tty,
    color,
    unicode,
    hyperlinks,
    animate: tty && color !== 'none' && !env.CI,
    columns: Math.max(20, out.columns ?? 80),
  };
}

// ── Colour ───────────────────────────────────────────────────────────────

export type Rgb = readonly [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** OKLab → sRGB (0–255), the same space Nacre's tokens are written in. */
export function oklab(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (v: number) => {
    const c = clamp01(v);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return linear.map((v) => Math.round(gamma(v) * 255)) as unknown as Rgb;
}

/** `oklch(L C h)`, as Nacre writes it. */
export function oklch(L: number, C: number, hue: number): Rgb {
  const h = (hue * Math.PI) / 180;
  return oklab(L, C * Math.cos(h), C * Math.sin(h));
}

/** Nacre's accent hue, and the hues of the pearl's iridescent films (`tokens.css`). */
export const ACCENT_HUE = 42;
export const PEARL_HUES = [ACCENT_HUE, 200, 265, 310, 355] as const;

/**
 * Nacre's palette for a terminal. The lightness sits in the middle, so each
 * reads on a dark terminal and a light one alike.
 */
export const PALETTE = {
  accent: oklch(0.7, 0.145, ACCENT_HUE),
  success: oklch(0.72, 0.15, 152),
  danger: oklch(0.66, 0.19, 20),
  warning: oklch(0.8, 0.15, 75),
  pearl: PEARL_HUES.map((h) => oklch(0.84, 0.1, h)),
} as const;

/** The 16 ANSI colours, roughly as terminals draw them, for the nearest match. */
const ANSI16: readonly (readonly [number, Rgb])[] = [
  [31, [205, 49, 49]],
  [32, [13, 188, 121]],
  [33, [229, 229, 16]],
  [34, [36, 114, 200]],
  [35, [188, 63, 188]],
  [36, [17, 168, 205]],
  [37, [229, 229, 229]],
  [91, [241, 76, 76]],
  [92, [35, 209, 139]],
  [93, [245, 245, 67]],
  [94, [59, 142, 234]],
  [95, [214, 112, 214]],
  [96, [41, 184, 219]],
  [97, [255, 255, 255]],
];

const distance = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** The closest of xterm's 256 colours (the 6×6×6 cube or the grey ramp). */
export function to256(rgb: Rgb): number {
  const step = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  const level = (i: number) => (i === 0 ? 0 : 55 + i * 40);
  const [r, g, b] = rgb.map(step) as unknown as [number, number, number];
  const cube: Rgb = [level(r), level(g), level(b)];
  const grey = Math.min(23, Math.max(0, Math.round(((rgb[0] + rgb[1] + rgb[2]) / 3 - 8) / 10)));
  const greyRgb: Rgb = [8 + grey * 10, 8 + grey * 10, 8 + grey * 10];
  return distance(rgb, cube) <= distance(rgb, greyRgb) ? 16 + 36 * r + 6 * g + b : 232 + grey;
}

/** The SGR code of the closest of the 16 colours. */
export function to16(rgb: Rgb): number {
  let best = ANSI16[0] as (typeof ANSI16)[number];
  for (const entry of ANSI16) if (distance(rgb, entry[1]) < distance(rgb, best[1])) best = entry;
  return best[0];
}

/** The escape that sets the text (or, with `bg`, the background) colour. Empty with no colour. */
export function colorCode(rgb: Rgb, depthOf: ColorDepth, bg = false): string {
  if (depthOf === 'none') return '';
  if (depthOf === 'truecolor') return `\x1b[${bg ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  if (depthOf === '256') return `\x1b[${bg ? 48 : 38};5;${to256(rgb)}m`;
  return `\x1b[${to16(rgb) + (bg ? 10 : 0)}m`;
}

// ── Measuring ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex -- matching terminal escapes is the point
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export const stripAnsi = (text: string) => text.replace(ESCAPES, '');

/** How many columns a character takes: emoji and CJK take two, combining marks none. */
function cells(code: number): number {
  if (code === 0xfe0f || code === 0x200d || (code >= 0x300 && code <= 0x36f)) return 0;
  if (
    code >= 0x1f000 ||
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    [0x2728, 0x26d4, 0x2705, 0x274c, 0x2b50, 0x23f3, 0x231b, 0x2615].includes(code)
  )
    return 2;
  return 1;
}

/** Columns `text` takes on screen, escapes not counted. */
export function width(text: string): number {
  let total = 0;
  for (const ch of stripAnsi(text)) total += cells(ch.codePointAt(0) ?? 0);
  return total;
}

/**
 * At most `max` columns of `text`, ending in "…" when cut. Escapes are kept
 * (and closed with a reset), so colour never bleeds past the cut.
 */
export function truncate(text: string, max: number): string {
  if (width(text) <= max) return text;
  let out = '';
  let used = 0;
  let last = 0;
  for (const match of text.matchAll(ESCAPES)) {
    const plain = text.slice(last, match.index);
    for (const ch of plain) {
      const w = cells(ch.codePointAt(0) ?? 0);
      if (used + w > max - 1) return `${out}…\x1b[0m`;
      out += ch;
      used += w;
    }
    out += match[0];
    last = match.index + match[0].length;
  }
  for (const ch of text.slice(last)) {
    const w = cells(ch.codePointAt(0) ?? 0);
    if (used + w > max - 1) return `${out}…\x1b[0m`;
    out += ch;
    used += w;
  }
  return out;
}

// ── Symbols ──────────────────────────────────────────────────────────────

export interface Symbols {
  ok: string;
  fail: string;
  warn: string;
  info: string;
  arrow: string;
  pointer: string;
  bullet: string;
  dot: string;
  ring: string;
  ellipsis: string;
  line: string;
  conch: string;
}

const UNICODE: Symbols = {
  ok: '✓',
  fail: '✗',
  warn: '!',
  info: 'ℹ',
  arrow: '→',
  pointer: '›',
  bullet: '•',
  dot: '●',
  ring: '○',
  ellipsis: '…',
  line: '─',
  conch: '🐚',
};

const ASCII: Symbols = {
  ok: 'v',
  fail: 'x',
  warn: '!',
  info: 'i',
  arrow: '->',
  pointer: '>',
  bullet: '*',
  dot: '*',
  ring: 'o',
  ellipsis: '...',
  line: '-',
  conch: '@',
};

// ── The kit ──────────────────────────────────────────────────────────────

export type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'pearl';

/** A line in progress that becomes ✓ (or ✗, or !) when it's done. */
export interface Step {
  /** Change what it says while it works. */
  update(label: string): void;
  done(text?: string): void;
  fail(text?: string): void;
  warn(text?: string): void;
}

export interface UiOptions {
  out?: Out;
  /** Override what was detected (tests; `--plain`). */
  term?: Partial<Term>;
  env?: Env;
  platform?: NodeJS.Platform;
}

const INDENT = '  ';

export class Ui {
  readonly out: Out;
  readonly term: Term;
  readonly sym: Symbols;

  constructor(options: UiOptions = {}) {
    this.out = options.out ?? process.stdout;
    this.term = {
      ...detectTerm(this.out, options.env ?? process.env, options.platform ?? process.platform),
      ...options.term,
    };
    this.sym = this.term.unicode ? UNICODE : ASCII;
  }

  // Styles ------------------------------------------------------------------

  #sgr(open: string, close: string, text: string) {
    return this.term.color === 'none' ? text : `\x1b[${open}m${text}\x1b[${close}m`;
  }

  bold = (text: string) => this.#sgr('1', '22', text);
  dim = (text: string) => this.#sgr('2', '22', text);
  italic = (text: string) => this.#sgr('3', '23', text);
  underline = (text: string) => this.#sgr('4', '24', text);

  /** Text in any colour, at the depth this terminal has. */
  paint = (rgb: Rgb, text: string): string => {
    const code = colorCode(rgb, this.term.color);
    return code ? `${code}${text}\x1b[39m` : text;
  };

  accent = (text: string) => this.paint(PALETTE.accent, text);
  success = (text: string) => this.paint(PALETTE.success, text);
  danger = (text: string) => this.paint(PALETTE.danger, text);
  warning = (text: string) => this.paint(PALETTE.warning, text);
  /** One of the pearl's film colours, for a touch of shimmer in static text. */
  pearl = (text: string, which = 2) =>
    this.paint(PALETTE.pearl[which % PALETTE.pearl.length] ?? PALETTE.accent, text);

  tone(tone: Tone, text: string): string {
    return this[tone](text);
  }

  // Writing -----------------------------------------------------------------

  /** Exactly these characters, nothing added. */
  write(text: string): void {
    this.out.write(text);
  }

  /** A line, indented like every line Conch prints; each line of `text` is. */
  say(text = ''): void {
    this.write(text ? `${INDENT}${text.replaceAll('\n', `\n${INDENT}`)}\n` : '\n');
  }

  blank(): void {
    this.write('\n');
  }

  /** ✓ in green: it worked. */
  ok(text: string): void {
    this.say(`${this.success(this.sym.ok)} ${text}`);
  }

  /** ! in amber: worth knowing, nothing broke. */
  note(text: string): void {
    this.say(`${this.warning(this.sym.warn)} ${text}`);
  }

  /** ✗ in red: it didn't work. Say what to do next on the next line. */
  error(text: string): void {
    this.say(`${this.danger(this.sym.fail)} ${text}`);
  }

  /** A quieter line underneath: the detail, the why, the hint. */
  hint(text: string): void {
    this.say(this.dim(text));
  }

  /**
   * A step that works for a while. In a terminal it's one line that turns
   * into ✓ (or ✗) in place; elsewhere it's "… label" now and "✓ label" later,
   * so a log reads the same story. Print nothing else until it ends.
   */
  step(label: string): Step {
    let current = label;
    const live = this.term.tty && this.term.color !== 'none';
    const fit = (text: string) => truncate(text, this.term.columns - 1);
    if (live) this.write(fit(`${INDENT}${this.dim(this.sym.ring)} ${current}`));
    else this.say(`${this.sym.ellipsis} ${current}`);
    let ended = false;
    const end = (mark: string, text?: string) => {
      if (ended) return;
      ended = true;
      if (live) this.write(`\r\x1b[2K${fit(`${INDENT}${mark} ${text ?? current}`)}\n`);
      else this.say(`${mark} ${text ?? current}`);
    };
    return {
      update: (next) => {
        if (ended) return;
        current = next;
        if (live) this.write(`\r\x1b[2K${fit(`${INDENT}${this.dim(this.sym.ring)} ${current}`)}`);
      },
      done: (text) => end(this.success(this.sym.ok), text),
      fail: (text) => end(this.danger(this.sym.fail), text),
      warn: (text) => end(this.warning(this.sym.warn), text),
    };
  }

  /**
   * A rounded card around the one thing that matters: a link, a code. Too
   * wide for the terminal, it drops its sides rather than break.
   */
  box(body: string | readonly string[], options: { title?: string; tone?: Tone } = {}): void {
    const lines = typeof body === 'string' ? body.split('\n') : [...body];
    const tone = (text: string) => (options.tone ? this.tone(options.tone, text) : this.dim(text));
    const inner = Math.max(width(options.title ?? '') + 2, ...lines.map(width));
    const u = this.term.unicode;
    if (inner + 6 + INDENT.length > this.term.columns) {
      if (options.title) this.say(this.bold(options.title));
      for (const line of lines) this.say(line);
      return;
    }
    const h = u ? '─' : '-';
    const [tl, tr, bl, br, v] = u ? ['╭', '╮', '╰', '╯', '│'] : ['+', '+', '+', '+', '|'];
    const title = options.title ? ` ${this.bold(options.title)} ` : '';
    // Two spaces either side of the text: every line is inner + 6 columns.
    this.say(`${tone(`${tl}${h}`)}${title}${tone(`${h.repeat(inner + 3 - width(title))}${tr}`)}`);
    for (const line of lines)
      this.say(`${tone(v)}  ${line}${' '.repeat(inner - width(line))}  ${tone(v)}`);
    this.say(tone(`${bl}${h.repeat(inner + 4)}${br}`));
  }

  /** A quiet line across, with an optional label: `── Devices ─────`. */
  rule(label?: string): void {
    const span = Math.min(56, this.term.columns - INDENT.length - 1);
    const h = this.sym.line;
    if (!label) return this.say(this.dim(h.repeat(span)));
    const rest = Math.max(2, span - width(label) - 4);
    this.say(`${this.dim(h.repeat(2))} ${this.bold(label)} ${this.dim(h.repeat(rest))}`);
  }

  /** Names and values in two columns. */
  kv(rows: readonly (readonly [string, string])[]): void {
    const pad = Math.max(...rows.map(([k]) => width(k))) + 2;
    for (const [k, v] of rows) this.say(`${this.dim(k)}${' '.repeat(pad - width(k))}${v}`);
  }

  /** A command to copy, set apart so it reads as one: `$ conch devices`. */
  code(command: string): string {
    return this.term.color === 'none' ? command : this.accent(this.bold(command));
  }

  /** Print a command on its own line, ready to copy. */
  command(command: string): void {
    this.say(`${this.dim('$')} ${this.code(command)}`);
  }

  /** A link: clickable where the terminal supports it, always shown in full. */
  link(url: string, text = url): string {
    const shown = this.term.color === 'none' ? text : this.underline(this.accent(text));
    return this.term.hyperlinks ? `\x1b]8;;${url}\x1b\\${shown}\x1b]8;;\x1b\\` : shown;
  }

  /** A QR code for `text`, when this terminal can draw one that fits. Returns whether it did. */
  qr(text: string): boolean {
    if (!this.term.unicode) return false;
    const lines = renderUnicodeCompact(text, { border: 2 }).split('\n');
    const wide = Math.max(...lines.map(width));
    if (wide + INDENT.length > this.term.columns) return false;
    for (const line of lines) this.say(line);
    return true;
  }
}

/** The kit for `process.stdout`, unless you pass somewhere else. */
export function createUi(options: UiOptions = {}): Ui {
  return new Ui(options);
}

/** A capture for tests: everything written, and the kit writing into it. */
export function captureUi(term: Partial<Term> = {}): { ui: Ui; text: () => string } {
  let buffer = '';
  const out: Out = {
    write: (chunk: string) => (buffer += chunk),
    isTTY: term.tty ?? false,
    columns: term.columns ?? 80,
  };
  const ui = new Ui({
    out,
    env: {},
    platform: 'linux',
    term: {
      tty: false,
      color: 'none',
      unicode: true,
      hyperlinks: false,
      animate: false,
      columns: 80,
      ...term,
    },
  });
  return { ui, text: () => buffer };
}

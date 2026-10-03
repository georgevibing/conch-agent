/**
 * The pearl, in a terminal.
 *
 * Nacre's `Pearl` is a small sphere of mother-of-pearl: a warm body lit from
 * the upper left, an iridescent film that's strongest toward the rim and
 * slowly turns, a counter-turning band for depth, and a fixed glint. This
 * draws the same thing with half blocks (▀ ▄): every character is two
 * square-ish pixels, each shaded in OKLab like the CSS gradients are.
 *
 * - `banner()`: the pearl beside "Conch" and a line, shimmering for a moment
 *   when the terminal can animate, still otherwise.
 * - `working()`: a one-line wait: a single bead whose colour drifts through
 *   the film, the caller's label, and after a few seconds a playful line.
 *
 * It degrades like the rest of the kit: 256 colours approximate each pixel,
 * 16 colours become 🐚 and a bead in the terminal's own colours, and with no
 * colour or no terminal it's plain words, printed once, with no cursor tricks.
 */
import { PEARL_HUES, colorCode, oklab, stripAnsi, truncate, width, type Rgb, type Ui } from './ui';
import { WAITING_LINES } from './words';

// ── Shading ──────────────────────────────────────────────────────────────

type Lab = readonly [number, number, number];

const lch = (L: number, C: number, hue: number): Lab => {
  const h = (hue * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
};
const mix = (a: Lab, b: Lab, t: number): Lab => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Piecewise-linear stops, like a CSS gradient's. */
function stops(list: readonly (readonly [number, number])[], t: number): number {
  const first = list[0] as readonly [number, number];
  if (t <= first[0]) return first[1];
  for (let i = 1; i < list.length; i++) {
    const [p1, v1] = list[i] as readonly [number, number];
    const [p0, v0] = list[i - 1] as readonly [number, number];
    if (t <= p1) return v0 + ((v1 - v0) * (t - p0)) / (p1 - p0);
  }
  return (list.at(-1) as readonly [number, number])[1];
}

/** The film's colour at an angle (0–1 around), through the five pearl hues. */
function film(turn: number): Lab {
  const t = (((turn % 1) + 1) % 1) * PEARL_HUES.length;
  const i = Math.floor(t);
  const a = lch(0.87, 0.075, PEARL_HUES[i % PEARL_HUES.length] ?? 0);
  const b = lch(0.87, 0.075, PEARL_HUES[(i + 1) % PEARL_HUES.length] ?? 0);
  return mix(a, b, t - i);
}

/**
 * The pearl's colour at a point of the unit disc (`x`, `y` in −1…1, y down),
 * `time` seconds in. Undefined outside the pearl.
 */
export function shade(x: number, y: number, time: number, spin = 6): Rgb | undefined {
  const r = Math.hypot(x, y);
  if (r > 1) return undefined;
  const tint = 42;
  // Body: a radial gradient from the light at the upper left (32% 28%).
  const fromLight = Math.hypot(x + 0.36, y + 0.44) / 1.75;
  const body = lch(
    stops(
      [
        [0, 0.995],
        [0.3, 0.95],
        [0.62, 0.84],
        [1, 0.7],
      ],
      fromLight,
    ),
    stops(
      [
        [0, 0.01],
        [0.3, 0.036],
        [0.62, 0.06],
        [1, 0.078],
      ],
      fromLight,
    ),
    tint +
      stops(
        [
          [0, 0],
          [0.62, 20],
          [1, 40],
        ],
        fromLight,
      ),
  );
  // Film: strongest toward the rim (a fresnel mask), turning with time.
  const angle = Math.atan2(y, x) / (2 * Math.PI);
  const rim = smooth(0.12, 0.92, Math.hypot(x + 0.2, y + 0.28) / 1.2);
  let colour = mix(body, film(angle + time / spin), rim * 0.62);
  // The counter-turning band: a softer second film, for slow "weather".
  const band = Math.max(0, Math.sin((angle - time / (spin * 1.6)) * Math.PI * 4));
  colour = mix(colour, film(angle * 2 - time / spin + 0.4), band * 0.18 * rim);
  // The glint, fixed like the light, and a faint reflection at the lower right.
  const glint = Math.max(0, 1 - ((x + 0.32) / 0.68) ** 2 - ((y + 0.48) / 0.48) ** 2);
  colour = mix(colour, [1, 0, 0], Math.min(0.95, glint ** 1.4 * 0.95));
  const bounce = Math.max(0, 1 - ((x - 0.24) / 0.6) ** 2 - ((y - 0.72) / 0.28) ** 2);
  colour = mix(colour, [1, 0, 0], bounce * 0.3);
  return oklab(colour[0], colour[1], colour[2]);
}

/** Average a pixel from a 3×3 grid of samples; a pixel mostly outside the pearl stays empty. */
function pixel(px: number, py: number, size: number, time: number): Rgb | undefined {
  const found: Rgb[] = [];
  for (let sy = 0; sy < 3; sy++)
    for (let sx = 0; sx < 3; sx++) {
      const x = ((px + (sx + 0.5) / 3) / size) * 2 - 1;
      const y = ((py + (sy + 0.5) / 3) / size) * 2 - 1;
      const c = shade(x * 1.04, y * 1.04, time);
      if (c) found.push(c);
    }
  if (found.length < 5) return undefined;
  const sum = found.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]] as Rgb, [0, 0, 0]);
  return sum.map((v) => Math.round(v / found.length)) as unknown as Rgb;
}

/** The size of the banner's pearl, in pixels (it's `PEARL_SIZE` columns by half as many rows). */
export const PEARL_SIZE = 10;

/**
 * The pearl as lines of text: `size` columns, `size / 2` rows of half blocks.
 * Each character's top pixel is its foreground (▀) and its bottom pixel the
 * background, so every pixel gets its own colour.
 */
export function pearlLines(ui: Ui, time = 0, size = PEARL_SIZE): string[] {
  const fg = (rgb: Rgb) => colorCode(rgb, ui.term.color);
  const bg = (rgb: Rgb) => colorCode(rgb, ui.term.color, true);
  // Without colour there's nothing to reset (the shape alone, for tests).
  const reset = ui.term.color === 'none' ? '' : '\x1b[0m';
  const lines: string[] = [];
  for (let row = 0; row < size / 2; row++) {
    let line = '';
    for (let col = 0; col < size; col++) {
      const top = pixel(col, row * 2, size, time);
      const bottom = pixel(col, row * 2 + 1, size, time);
      if (top && bottom) line += `${fg(top)}${bg(bottom)}▀${reset}`;
      else if (top) line += `${fg(top)}▀${reset}`;
      else if (bottom) line += `${fg(bottom)}▄${reset}`;
      else line += ' ';
    }
    lines.push(line);
  }
  return lines;
}

/** A single bead of the pearl's film, `time` seconds in: the spinner's mark. */
export function bead(ui: Ui, time: number): string {
  const symbol = ui.term.unicode ? '●' : '*';
  if (ui.term.color === 'none') return symbol;
  if (ui.term.color === '16') {
    const cycle = [35, 36, 33, 37];
    return `\x1b[${cycle[Math.floor(time * 3) % cycle.length]}m${symbol}\x1b[39m`;
  }
  const lab = mix(film(time / 2.4), [0.97, 0, 0], 0.15 + 0.15 * Math.sin(time * 3));
  return `${colorCode(oklab(lab[0], lab[1], lab[2]), ui.term.color)}${symbol}\x1b[39m`;
}

// ── Cursor safety ────────────────────────────────────────────────────────

/**
 * Hide the cursor while something animates, and make sure it comes back:
 * on stop, on exit, and on Ctrl+C (which then ends the program as usual).
 */
export function hideCursor(ui: Ui): () => void {
  if (!ui.term.animate) return () => undefined;
  ui.write('\x1b[?25l');
  const show = () => ui.write('\x1b[?25h');
  const onExit = () => show();
  const onSigint = () => {
    show();
    ui.write('\n');
    process.exit(130);
  };
  process.once('exit', onExit);
  process.once('SIGINT', onSigint);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    process.off('exit', onExit);
    process.off('SIGINT', onSigint);
    show();
  };
}

const FPS = 12;

// ── The banner ───────────────────────────────────────────────────────────

export interface BannerOptions {
  title?: string;
  /** The line under the title: what this command is about. */
  line?: string;
  /** A quieter third line (a version, an address). */
  sub?: string;
  /** Shimmer this long before settling, when the terminal can animate. */
  shimmer?: number;
  /** For tests: where the shimmer starts. */
  time?: number;
}

/**
 * Conch's hello: the pearl with the title beside it. Wide, colourful
 * terminals get the drawn pearl (shimmering for `shimmer` ms); the rest get
 * 🐚 and the words on one line.
 */
export async function banner(ui: Ui, options: BannerOptions = {}): Promise<void> {
  const title = options.title ?? 'Conch';
  const text = [
    '',
    ui.bold(title),
    options.line ? options.line : '',
    options.sub ? ui.dim(options.sub) : '',
    '',
  ];
  const drawn =
    (ui.term.color === 'truecolor' || ui.term.color === '256') &&
    ui.term.unicode &&
    ui.term.columns >= PEARL_SIZE + 4 + Math.max(...text.map(width)) + 4;
  if (!drawn) {
    ui.blank();
    const mark = ui.term.unicode && ui.term.color !== 'none' ? `${ui.sym.conch}  ` : '';
    ui.say(`${mark}${ui.bold(title)}${options.line ? `  ${ui.dim('·')}  ${options.line}` : ''}`);
    if (options.sub) ui.say(ui.dim(options.sub));
    ui.blank();
    return;
  }
  const frame = (time: number) =>
    pearlLines(ui, time).map((pearl, i) => `  ${pearl}   ${text[i] ?? ''}`.trimEnd());
  const start = options.time ?? 0;
  ui.blank();
  const shimmer = ui.term.animate ? (options.shimmer ?? 0) : 0;
  if (shimmer <= 0) {
    for (const line of frame(start)) ui.write(`${line}\n`);
    ui.blank();
    return;
  }
  const release = hideCursor(ui);
  const rows = PEARL_SIZE / 2;
  const began = Date.now();
  try {
    let first = true;
    for (;;) {
      const elapsed = (Date.now() - began) / 1000;
      if (!first) ui.write(`\x1b[${rows}A`);
      first = false;
      // A quick turn while arriving, easing into the resting spin.
      const time = start + elapsed * (1 + 2 * Math.max(0, 1 - (elapsed * 1000) / shimmer));
      for (const line of frame(time)) ui.write(`\r\x1b[2K${line}\n`);
      if (elapsed * 1000 >= shimmer) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 / FPS));
    }
  } finally {
    release();
  }
  ui.blank();
}

// ── Working ──────────────────────────────────────────────────────────────

export interface WorkingOptions<T> {
  /** What to say when it worked (default: the label). */
  done?: string | ((result: T) => string);
  /** What to say when it failed (default: the error's message). The error is thrown on. */
  failed?: (error: unknown) => string;
  /** After this long, a playful line joins the label. */
  chatterAfter?: number;
  /** How long each playful line stays. */
  chatterEvery?: number;
  lines?: readonly string[];
}

/** What a task can do while it works. */
export interface Working {
  /** Change the label: "Looking up conch.example.com (try 3)". */
  update(label: string): void;
}

/**
 * Run `task` with a shimmering bead and `label` beside it, then leave ✓ (or
 * ✗) in its place. Long waits pick up a playful line after a few seconds;
 * the label always stays, because it's what's really happening.
 */
export async function working<T>(
  ui: Ui,
  label: string,
  task: (working: Working) => Promise<T>,
  options: WorkingOptions<T> = {},
): Promise<T> {
  let current = label;
  const doneText = (result: T) =>
    typeof options.done === 'function' ? options.done(result) : (options.done ?? current);
  const failText = (error: unknown) =>
    options.failed?.(error) ?? (error instanceof Error ? error.message : String(error));

  if (!ui.term.animate) {
    ui.say(`${ui.dim(ui.sym.ellipsis)} ${label}`);
    try {
      const result = await task({ update: (next) => void (current = next) });
      ui.ok(doneText(result));
      return result;
    } catch (error) {
      ui.error(failText(error));
      throw error;
    }
  }

  const lines = options.lines ?? WAITING_LINES;
  const chatterAfter = options.chatterAfter ?? 4000;
  const chatterEvery = options.chatterEvery ?? 3200;
  const began = Date.now();
  const draw = () => {
    const elapsed = Date.now() - began;
    let line = `  ${bead(ui, elapsed / 1000)} ${current}`;
    if (elapsed >= chatterAfter && lines.length) {
      const which = Math.floor((elapsed - chatterAfter) / chatterEvery) % lines.length;
      line += `  ${ui.dim(`${ui.sym.bullet} ${lines[which] ?? ''}`)}`;
    }
    ui.write(`\r\x1b[2K${truncate(line, ui.term.columns - 1)}`);
  };
  const release = hideCursor(ui);
  draw();
  const timer = setInterval(draw, 1000 / FPS);
  const finish = (mark: string, text: string) => {
    clearInterval(timer);
    ui.write(`\r\x1b[2K${truncate(`  ${mark} ${text}`, ui.term.columns - 1)}\n`);
    release();
  };
  try {
    const result = await task({
      update: (next) => {
        current = next;
        draw();
      },
    });
    finish(ui.success(ui.sym.ok), doneText(result));
    return result;
  } catch (error) {
    finish(ui.danger(ui.sym.fail), failText(error));
    throw error;
  }
}

/** The words of a banner or a line, without its colours (for tests and logs). */
export const plain = (text: string) => stripAnsi(text);

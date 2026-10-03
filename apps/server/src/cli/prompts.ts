/**
 * Asking a person something in a terminal.
 *
 * Questions come from the keyboard even when the command itself arrives
 * through a pipe (`curl … | sh`): like `install.sh`'s `has_keyboard`, Conch
 * opens the terminal directly when standard input isn't one. With no
 * keyboard at all, nothing is asked: each question returns its default (or
 * nothing), so a script never hangs.
 *
 * - `ask`: a line of text; `hidden` for passwords (nothing typed is shown).
 * - `confirm`: yes or no, the default in capitals.
 * - `choose`: one of a few options. In a terminal, ↑ ↓ (or j k) and Enter,
 *   or the option's number; elsewhere a numbered list and a number.
 *
 * Ctrl+C stops the command with a friendly line (and the terminal as it was);
 * Ctrl+D is no answer.
 */
import { openSync } from 'node:fs';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { Writable } from 'node:stream';
import { ReadStream } from 'node:tty';

import type { Ui } from './ui';
import { STOPPED } from './words';

/** What a prompt reads keys from. */
export interface KeyboardInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?(on: boolean): unknown;
}

export interface Keyboard {
  input: KeyboardInput;
  /** Let go of it, so the program can end. */
  close(): void;
}

/**
 * The keyboard: standard input when it's a terminal, otherwise the terminal
 * itself (`/dev/tty`) when there is one. Undefined when nobody can answer.
 */
export function openKeyboard(
  stdin: KeyboardInput = process.stdin,
  platform: NodeJS.Platform = process.platform,
): Keyboard | undefined {
  if (stdin.isTTY) return { input: stdin, close: () => void stdin.pause() };
  if (platform === 'win32') return undefined;
  try {
    const input = new ReadStream(openSync('/dev/tty', 'r'));
    return { input, close: () => input.destroy() };
  } catch {
    return undefined;
  }
}

export interface Option<T> {
  value: T;
  label: string;
  /** A quieter word or two after the label. */
  hint?: string;
}

export interface PromptOptions {
  ui: Ui;
  /** The keyboard; found by itself when left out. `null` means nobody can answer. */
  keyboard?: Keyboard | null;
  /** What Ctrl+C does after the terminal is put back (default: say so and exit 130). */
  onCancel?: () => void;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

export class Prompts {
  readonly #ui: Ui;
  #keyboard: Keyboard | null | undefined;
  readonly #onCancel: () => void;

  constructor(options: PromptOptions) {
    this.#ui = options.ui;
    this.#keyboard = options.keyboard;
    this.#onCancel =
      options.onCancel ??
      (() => {
        this.#ui.blank();
        this.#ui.hint(STOPPED);
        this.#ui.blank();
        process.exit(130);
      });
  }

  #board(): Keyboard | null {
    if (this.#keyboard === undefined) this.#keyboard = openKeyboard() ?? null;
    return this.#keyboard;
  }

  /** Someone can answer (a keyboard is there). */
  get interactive(): boolean {
    return this.#board() !== null;
  }

  /** Put the keyboard back, so the program can end. */
  close(): void {
    this.#keyboard?.close();
  }

  /**
   * A line of text. Returns `default` for an empty answer, and undefined when
   * nobody can answer (no keyboard, or Ctrl+D). `validate` returns what's
   * wrong, in a sentence, or nothing; the question is asked again until it's right.
   */
  async ask(
    question: string,
    options: {
      hidden?: boolean;
      default?: string;
      validate?: (answer: string) => string | undefined;
    } = {},
  ): Promise<string | undefined> {
    const keyboard = this.#board();
    if (!keyboard) return options.default;
    for (;;) {
      const shown =
        options.default && !options.hidden ? ` ${this.#ui.dim(`(${options.default})`)}` : '';
      const raw = await this.#line(keyboard, `${question}${shown} `, options.hidden ?? false);
      if (raw === undefined) return options.default;
      const answer = (options.hidden ? raw : raw.trim()) || options.default || '';
      const problem = options.validate?.(answer);
      if (!problem) return answer;
      this.#ui.note(problem);
    }
  }

  /** Yes or no. Enter (or no keyboard) takes the default. */
  async confirm(question: string, fallback = true): Promise<boolean> {
    const choices = fallback ? 'Y/n' : 'y/N';
    const answer = await this.ask(`${question} ${this.#ui.dim(`[${choices}]`)}`, {
      validate: (a) => (a === '' || /^(y|yes|n|no)$/i.test(a) ? undefined : 'Type y or n.'),
    });
    if (!answer) return fallback;
    return /^y/i.test(answer);
  }

  /**
   * One of `options`. In a terminal: ↑ ↓ or a number, then Enter. Elsewhere,
   * a numbered list and a number (or the start of a label). Undefined when
   * nobody can answer and there's no default.
   */
  async choose<T>(
    question: string,
    options: readonly Option<T>[],
    selected = 0,
  ): Promise<T | undefined> {
    const keyboard = this.#board();
    const fallback = options[selected]?.value;
    if (!keyboard || !options.length) return fallback;
    const { input } = keyboard;
    if (input.isTTY && input.setRawMode && this.#ui.term.tty) {
      return this.#arrows(keyboard, question, options, selected);
    }
    this.#ui.say(this.#ui.bold(question));
    options.forEach((o, i) =>
      this.#ui.say(`  ${this.#ui.accent(String(i + 1))}  ${this.#line1(o)}`),
    );
    const answer = await this.ask(`Choose 1–${options.length}:`, {
      default: String(selected + 1),
      validate: (a) =>
        pickOption(options, a) === undefined
          ? `Choose a number from 1 to ${options.length}.`
          : undefined,
    });
    return answer === undefined
      ? fallback
      : options[pickOption(options, answer) ?? selected]?.value;
  }

  #line1(option: Option<unknown>): string {
    return option.hint ? `${option.label}  ${this.#ui.dim(option.hint)}` : option.label;
  }

  /** One line from the keyboard, with nothing echoed when `hidden`. Undefined on Ctrl+D. */
  #line(keyboard: Keyboard, prompt: string, hidden: boolean): Promise<string | undefined> {
    const ui = this.#ui;
    let muted = false;
    const output = new Writable({
      write(chunk: Buffer, _encoding, done) {
        if (!muted) ui.write(chunk.toString());
        done();
      },
    });
    const rl = createInterface({
      input: keyboard.input,
      output,
      terminal: Boolean(keyboard.input.isTTY),
    });
    return new Promise((resolve) => {
      let settled = false;
      rl.question(`  ${prompt}`, (answer) => {
        settled = true;
        rl.close();
        if (hidden) ui.write('\n');
        resolve(answer);
      });
      muted = hidden;
      rl.on('SIGINT', () => {
        settled = true;
        rl.close();
        ui.write('\n');
        this.#onCancel();
        resolve(undefined);
      });
      // Ctrl+D (or input that ends) is no answer, never a hang.
      rl.on('close', () => {
        if (settled) return;
        settled = true;
        ui.write('\n');
        resolve(undefined);
      });
    });
  }

  #arrows<T>(
    keyboard: Keyboard,
    question: string,
    options: readonly Option<T>[],
    start: number,
  ): Promise<T | undefined> {
    const ui = this.#ui;
    const { input } = keyboard;
    let at = Math.min(Math.max(0, start), options.length - 1);
    const row = (o: Option<T>, i: number) =>
      i === at
        ? `${ui.accent(ui.sym.pointer)} ${ui.accent(String(i + 1))}  ${ui.bold(o.label)}${o.hint ? `  ${ui.dim(o.hint)}` : ''}`
        : `  ${ui.dim(String(i + 1))}  ${o.label}${o.hint ? `  ${ui.dim(o.hint)}` : ''}`;
    const draw = (again: boolean) => {
      if (again) ui.write(`\x1b[${options.length}A`);
      options.forEach((o, i) => ui.write(`\r\x1b[2K  ${row(o, i)}\n`));
    };
    ui.say(`${ui.bold(question)}  ${ui.dim('↑ ↓ and Enter, or a number')}`);
    ui.write('\x1b[?25l');
    draw(false);
    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    return new Promise((resolve) => {
      const finish = (value: T | undefined, cancelled = false) => {
        input.off('keypress', onKey);
        input.setRawMode?.(false);
        input.pause();
        // Fold the list into one line: the question and what was chosen.
        ui.write(`\x1b[${options.length + 1}A\r\x1b[0J`);
        const chosen = options.find((o) => o.value === value);
        ui.say(`${ui.bold(question)}  ${chosen ? ui.accent(chosen.label) : ui.dim('no answer')}`);
        ui.write('\x1b[?25h');
        if (cancelled) this.#onCancel();
        resolve(value);
      };
      const onKey = (text: string | undefined, key: Key | undefined) => {
        const name = key?.name;
        if (key?.ctrl && name === 'c') return finish(undefined, true);
        if (key?.ctrl && name === 'd') return finish(undefined);
        if (name === 'up' || name === 'k') at = (at - 1 + options.length) % options.length;
        else if (name === 'down' || name === 'j' || name === 'tab') at = (at + 1) % options.length;
        else if (name === 'return' || name === 'enter') return finish(options[at]?.value);
        else if (text && /^[1-9]$/.test(text) && Number(text) <= options.length)
          return finish(options[Number(text) - 1]?.value);
        else return;
        draw(true);
      };
      input.on('keypress', onKey);
    });
  }
}

/** The option an answer names: its number, or the start of its label. */
export function pickOption(
  options: readonly Option<unknown>[],
  answer: string,
): number | undefined {
  const text = answer.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= options.length ? n - 1 : undefined;
  }
  if (!text) return undefined;
  const found = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
  return found >= 0 ? found : undefined;
}

export function createPrompts(options: PromptOptions): Prompts {
  return new Prompts(options);
}

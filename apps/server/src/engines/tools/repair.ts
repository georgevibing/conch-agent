/**
 * Mending tool-call arguments a model got almost right (ADR 0069).
 *
 * Small models, and big ones on a bad day, write JSON a strict parser refuses:
 * a trailing comma, single quotes, a key without quotes, `True`, a code fence
 * around it, the closing brace never written, or two objects run together.
 * Every one of those still says plainly what the model meant, so Conch reads
 * it rather than sending the model back to try again.
 *
 * Valid JSON never comes here: `JSON.parse` answers first, so a well-formed
 * call means exactly what it says. The tolerant reader is in-house and small
 * on purpose. It only builds plain data (objects, arrays, strings, numbers,
 * booleans, null); it never evaluates anything, it caps the size and the
 * nesting it will read, and it builds objects with `Object.fromEntries`, so a
 * `__proto__` key is an ordinary key and never reaches a prototype.
 */

/** Longer than any sensible arguments: past this, reading is refused rather than slow. */
const MAX_INPUT = 1_000_000;
/** Deeper than any tool's arguments: past this, the text is refused rather than recursed into. */
const MAX_DEPTH = 64;
/** Concatenated values read at most; the rest is ignored. */
const MAX_VALUES = 16;

export interface Repaired {
  /** The first value read. */
  value: unknown;
  /** Further top-level values written after it (`{…}{…}`). */
  rest: unknown[];
  /** What was mended, in a few words each. Empty when the text was valid JSON. */
  fixes: string[];
}

class Unreadable extends Error {}

/** The body of a markdown code fence, when the text is one (or holds one). */
function unfence(text: string): string | undefined {
  const whole = /^```[\w-]*[^\S\n]*\n?([\s\S]*?)\n?[^\S\n]*```\s*$/.exec(text);
  if (whole) return whole[1];
  // An unclosed fence: everything after the opening line.
  const open = /^```[\w-]*[^\S\n]*\n([\s\S]*)$/.exec(text);
  if (open && !open[1]?.includes('```')) return open[1];
  // Words around a fence: the first fenced block.
  const inner = /```[\w-]*[^\S\n]*\n([\s\S]*?)\n?[^\S\n]*```/.exec(text);
  return inner?.[1];
}

const LITERALS: Record<string, unknown> = {
  true: true,
  false: false,
  null: null,
  True: true,
  False: false,
  None: null,
  undefined: null,
};

/** A forgiving reader for JSON-like text. Throws `Unreadable` when there's nothing to read. */
class Reader {
  i = 0;
  readonly fixes = new Set<string>();

  constructor(readonly s: string) {}

  get done() {
    return this.i >= this.s.length;
  }

  get char() {
    return this.s[this.i] ?? '';
  }

  space() {
    for (;;) {
      while (!this.done && /\s/.test(this.char)) this.i++;
      if (this.s.startsWith('//', this.i)) {
        const end = this.s.indexOf('\n', this.i);
        this.i = end === -1 ? this.s.length : end + 1;
        this.fixes.add('comments');
      } else if (this.s.startsWith('/*', this.i)) {
        const end = this.s.indexOf('*/', this.i + 2);
        this.i = end === -1 ? this.s.length : end + 2;
        this.fixes.add('comments');
      } else return;
    }
  }

  value(depth: number): unknown {
    if (depth > MAX_DEPTH) throw new Unreadable('too deep');
    this.space();
    const c = this.char;
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"' || c === "'" || c === '`') return this.string();
    if (c === '-' || c === '+' || c === '.' || /\d/.test(c)) return this.number();
    if (/[A-Za-z_$]/.test(c)) {
      const word = this.word();
      if (Object.hasOwn(LITERALS, word)) {
        if (!['true', 'false', 'null'].includes(word)) this.fixes.add(`${word} written for JSON`);
        return LITERALS[word];
      }
      this.fixes.add('text without quotes');
      return word;
    }
    throw new Unreadable(this.done ? 'ended early' : `unexpected ${c}`);
  }

  word(): string {
    const start = this.i;
    while (!this.done && /[\w$.-]/.test(this.char)) this.i++;
    return this.s.slice(start, this.i);
  }

  object(depth: number): Record<string, unknown> {
    this.i++;
    const entries: [string, unknown][] = [];
    for (;;) {
      this.space();
      if (this.done) {
        this.fixes.add('a missing closing brace');
        break;
      }
      const c = this.char;
      if (c === '}') {
        this.i++;
        break;
      }
      if (c === ',') {
        this.i++;
        this.space();
        if (this.char === '}' || this.done) this.fixes.add('a trailing comma');
        continue;
      }
      if (c === ']') {
        // `{…]`: the brace was meant.
        this.i++;
        this.fixes.add('a mismatched bracket');
        break;
      }
      let key: string;
      if (c === '"' || c === "'" || c === '`') key = this.string();
      else if (/[A-Za-z_$\d]/.test(c)) {
        key = this.word();
        this.fixes.add('keys without quotes');
      } else throw new Unreadable(`unexpected ${c}`);
      this.space();
      if (this.char === ':' || this.char === '=') this.i++;
      else this.fixes.add('a missing colon');
      this.space();
      if (this.done || this.char === '}' || this.char === ',') {
        this.fixes.add('a key without a value');
        entries.push([key, null]);
        continue;
      }
      entries.push([key, this.value(depth + 1)]);
      this.space();
      if (this.char === ',' || this.char === '}' || this.done) continue;
      // `{"a": 1 "b": 2}`: the comma was meant.
      this.fixes.add('a missing comma');
    }
    // `Object.fromEntries` defines own properties: `__proto__` stays a plain key.
    return Object.fromEntries(entries);
  }

  array(depth: number): unknown[] {
    this.i++;
    const items: unknown[] = [];
    for (;;) {
      this.space();
      if (this.done) {
        this.fixes.add('a missing closing bracket');
        break;
      }
      const c = this.char;
      if (c === ']') {
        this.i++;
        break;
      }
      if (c === ',') {
        this.i++;
        this.space();
        if (this.char === ']' || this.done) this.fixes.add('a trailing comma');
        continue;
      }
      if (c === '}') {
        this.i++;
        this.fixes.add('a mismatched bracket');
        break;
      }
      items.push(this.value(depth + 1));
      this.space();
      if (this.char === ',' || this.char === ']' || this.done) continue;
      this.fixes.add('a missing comma');
    }
    return items;
  }

  string(): string {
    const quote = this.char;
    if (quote !== '"') this.fixes.add(quote === "'" ? 'single quotes' : 'backticks');
    this.i++;
    let out = '';
    for (;;) {
      if (this.done) {
        this.fixes.add('an unclosed string');
        return out;
      }
      const c = this.char;
      this.i++;
      if (c === quote) return out;
      if (c === '\\') {
        const n = this.char;
        this.i++;
        switch (n) {
          case 'n':
            out += '\n';
            break;
          case 't':
            out += '\t';
            break;
          case 'r':
            out += '\r';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'u': {
            const hex = this.s.slice(this.i, this.i + 4);
            if (/^[0-9a-f]{4}$/i.test(hex)) {
              out += String.fromCharCode(parseInt(hex, 16));
              this.i += 4;
            } else out += 'u';
            break;
          }
          case '':
            break;
          default:
            // `\"`, `\\`, `\/`, `\'` and anything else: the character itself.
            out += n;
        }
        continue;
      }
      if (c === '\n' && quote === '"') this.fixes.add('line breaks inside a string');
      out += c;
    }
  }

  number(): number {
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      this.s.slice(this.i, this.i + 64),
    );
    if (!match) throw new Unreadable('not a number');
    this.i += match[0].length;
    const n = Number(match[0]);
    if (!Number.isFinite(n)) throw new Unreadable('not a finite number');
    if (match[0].startsWith('+') || match[0].startsWith('.') || /\.(?:$|[eE])/.test(match[0]))
      this.fixes.add('a loosely written number');
    return n;
  }
}

/**
 * The value in JSON-like text, mended where a model's slip is unambiguous.
 * Undefined when there's no value to be had (empty, prose, or beyond the
 * size and depth limits).
 */
export function repairJson(raw: string): Repaired | undefined {
  if (raw.length > MAX_INPUT) return undefined;
  let text = raw.trim();
  if (!text) return undefined;
  const fixes: string[] = [];
  try {
    return { value: JSON.parse(text) as unknown, rest: [], fixes };
  } catch {
    /* Mended below. */
  }
  const fenced = text.includes('```') ? unfence(text) : undefined;
  if (fenced !== undefined) {
    text = fenced.trim();
    fixes.push('a code fence');
    try {
      return { value: JSON.parse(text) as unknown, rest: [], fixes };
    } catch {
      /* Mended below. */
    }
  }
  // Words before the value: start at the first brace or bracket.
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
  if (start > 0) fixes.push('words before the arguments');
  const reader = new Reader(text.slice(start));
  const values: unknown[] = [];
  try {
    while (values.length < MAX_VALUES) {
      reader.space();
      if (reader.done) break;
      if (reader.char !== '{' && reader.char !== '[') {
        if (values.length) reader.fixes.add('words after the arguments');
        break;
      }
      values.push(reader.value(0));
      // `{…},{…}` and `{…}\n{…}` are both several values.
      reader.space();
      if ((reader.char as string) === ',') reader.i++;
    }
  } catch (error) {
    if (!(error instanceof Unreadable) || !values.length) return undefined;
  }
  if (!values.length) return undefined;
  return {
    value: values[0],
    rest: values.slice(1),
    fixes: [...fixes, ...reader.fixes, ...(values.length > 1 ? ['several values'] : [])],
  };
}

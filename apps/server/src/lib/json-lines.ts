/**
 * One JSON message a line, from a program's stdout as the bytes come (Codex's
 * app server, ACP agents). A picture makes these lines big: a program echoes
 * the photo it was sent, or replays a whole conversation with every photo in
 * it, as base64 inside the JSON. Conch never needs those bytes back (it sent
 * them, and keeps them itself), so a long base64 string is set aside as it's
 * read: only its `data:image/…;base64,` start is kept, and the line stays as
 * small as the words around it. A 20 MB echo costs a few kilobytes, read once.
 *
 * What's kept of one line is bounded (`max`). A line that still passes it is
 * skipped, never the connection: the turn goes on, and `skipped` hears the
 * start of it, so a request it answered can say so instead of waiting.
 *
 * A newline byte is never part of a UTF-8 character, and JSON never has a raw
 * newline inside a string, so a line ends exactly where one is, whatever the
 * chunks split; strings are only ever cut at ASCII bytes, so what's kept
 * always decodes.
 */

/** What one line keeps, at most, once long base64 is set aside. */
export const MAX_KEPT = 64 * 1024 * 1024;
/** A string longer than this, all base64, is set aside. Words and code are never cut. */
export const LONG_STRING = 64 * 1024;
/** How much of a skipped line is kept to tell what it was. */
const HEAD = 4096;

const NL = 0x0a;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
/** Base64 (standard or URL-safe), with an optional `data:<type>;base64,` start. */
const BASE64 = /^(data:[\w.+/-]{1,100}(?:;[\w=.+-]{1,100})*;base64,)?[A-Za-z0-9+/_=-]*$/;

export interface JsonLinesOptions {
  /** The most one line keeps (`MAX_KEPT`). */
  max?: number;
  /**
   * Long base64 strings are set aside (the default), or kept whole for a
   * connection that's reading a picture back.
   */
  keepLong?: boolean;
  /** Strings at least this long are looked at (`LONG_STRING`). */
  long?: number;
}

/** What's known of a line that was too long to keep. */
export interface SkippedLine {
  /** Its first few kilobytes, as text. */
  head: string;
  /** How many bytes it was. */
  size: number;
}

export class JsonLines {
  readonly max: number;
  readonly #long: number;
  readonly #keepLong: boolean;
  #buf = Buffer.allocUnsafe(64 * 1024);
  #len = 0;
  /** Bytes of the line so far, kept or not. */
  #size = 0;
  #inString = false;
  #escaped = false;
  /** Where the current string's content starts in `#buf`. */
  #strStart = 0;
  /** The current string was looked at and isn't base64: it's kept whole. */
  #checked = false;
  /** The current string is being set aside until it closes. */
  #setAside = false;
  /** The line passed `max`: only its head is held, and it won't be read. */
  #over = false;

  constructor(options: JsonLinesOptions = {}) {
    this.max = options.max ?? MAX_KEPT;
    this.#long = options.long ?? LONG_STRING;
    this.#keepLong = options.keepLong ?? false;
  }

  /** The lines `chunk` finished, and the ones too long to keep. */
  push(chunk: Buffer): { lines: string[]; skipped: SkippedLine[] } {
    const lines: string[] = [];
    const skipped: SkippedLine[] = [];
    let from = 0;
    const n = chunk.length;
    for (let i = 0; i < n; i++) {
      const c = chunk[i];
      if (c === NL) {
        if (!this.#setAside) this.#append(chunk, from, i);
        this.#size += i - from;
        if (this.#over)
          skipped.push({ head: this.#buf.toString('utf8', 0, this.#len), size: this.#size });
        else lines.push(this.#buf.toString('utf8', 0, this.#len));
        this.#reset();
        from = i + 1;
        continue;
      }
      if (!this.#inString) {
        if (c === QUOTE) {
          this.#inString = true;
          this.#escaped = false;
          this.#checked = this.#keepLong;
          this.#strStart = this.#len + (i + 1 - from);
        }
        continue;
      }
      if (this.#escaped) this.#escaped = false;
      else if (c === BACKSLASH) this.#escaped = true;
      else if (c === QUOTE) {
        this.#inString = false;
        if (this.#setAside) {
          // What was set aside ends here; the closing quote is kept.
          this.#setAside = false;
          this.#size += i - from;
          from = i;
        }
        continue;
      }
      if (this.#setAside) continue;
      if (!this.#checked && this.#len + (i + 1 - from) - this.#strStart > this.#long) {
        this.#append(chunk, from, i + 1);
        this.#size += i + 1 - from;
        from = i + 1;
        this.#checked = true;
        if (!this.#over) {
          const sofar = this.#buf.toString('latin1', this.#strStart, this.#len);
          const base64 = BASE64.exec(sofar);
          if (base64) {
            this.#len = this.#strStart + (base64[1]?.length ?? 0);
            this.#setAside = true;
          }
        }
      }
    }
    if (from < n) {
      if (!this.#setAside) this.#append(chunk, from, n);
      this.#size += n - from;
    }
    return { lines, skipped };
  }

  #append(chunk: Buffer, from: number, to: number): void {
    const count = to - from;
    if (count <= 0) return;
    if (this.#over) {
      // Only the head is held, to tell what the line was.
      const room = HEAD - this.#len;
      if (room > 0) {
        chunk.copy(this.#buf, this.#len, from, from + Math.min(room, count));
        this.#len += Math.min(room, count);
      }
      return;
    }
    if (this.#len + count > this.max) {
      this.#over = true;
      this.#len = Math.min(this.#len, HEAD);
      // The string being read is past the head now: nothing more of it to place.
      this.#strStart = Math.min(this.#strStart, this.#len);
      this.#append(chunk, from, to);
      return;
    }
    if (this.#len + count > this.#buf.length) {
      const grown = Buffer.allocUnsafe(
        Math.min(this.max, Math.max(this.#len + count, this.#buf.length * 2)),
      );
      this.#buf.copy(grown, 0, 0, this.#len);
      this.#buf = grown;
    }
    chunk.copy(this.#buf, this.#len, from, to);
    this.#len += count;
  }

  #reset(): void {
    this.#len = 0;
    this.#size = 0;
    this.#inString = false;
    this.#escaped = false;
    this.#checked = false;
    this.#setAside = false;
    this.#over = false;
    // A big line's room is given back, so one photo doesn't hold memory for the whole chat.
    if (this.#buf.length > 1024 * 1024) this.#buf = Buffer.allocUnsafe(64 * 1024);
  }
}

/** The request a line answered, from its start (`{"id":7,…`), when it says. */
export function answeredId(head: string): number | undefined {
  const found = /^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?"id"\s*:\s*(\d{1,15})\s*,/.exec(head);
  return found ? Number(found[1]) : undefined;
}

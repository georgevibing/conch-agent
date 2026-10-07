/**
 * A provider's progress notes for the person watching (ADR 0103), made fit
 * for the chat's live line: plain words without markdown, one line, at most
 * 240 characters, the same note never twice in a row, and never more than
 * one every half second (a burst says only its latest).
 */

/** The protocol's ceiling for a `narration` line. */
export const NARRATION_MAX = 240;
/** At most one line this often; what comes between waits, and only the latest goes. */
export const NARRATION_EVERY_MS = 500;

/** A note in plain words: markdown, links and list marks gone, one line, capped. Empty: nothing to say. */
export function cleanNarration(raw: string): string {
  const flat = raw
    // Pictures and links say their words.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Headings, quotes and list marks at the start of a line.
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+•]\s+|\d+[.)]\s+)/gm, '')
    // Emphasis and code marks around words.
    .replace(/(\*{1,3}|_{1,3}|~~|`+)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/`+/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= NARRATION_MAX) return flat;
  const cut = flat.slice(0, NARRATION_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > NARRATION_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface NarrationLine {
  text: string;
  toolUseId?: string;
}

/**
 * Paces one turn's notes. `say` hands a line to `emit` at once when the last
 * one went long enough ago; else it waits for the rest of the half second,
 * and a newer note replaces it meanwhile. `close` drops what's waiting, so
 * nothing lands after the turn has ended.
 */
export class NarrationPacer {
  #last?: { text: string; at: number };
  #waiting?: NarrationLine;
  #timer?: NodeJS.Timeout;

  constructor(
    private readonly emit: (line: NarrationLine) => void,
    private readonly now: () => number = Date.now,
    private readonly everyMs = NARRATION_EVERY_MS,
  ) {}

  say(raw: string, toolUseId?: string): void {
    const text = cleanNarration(raw);
    if (!text) return;
    const line: NarrationLine = { text, ...(toolUseId && { toolUseId }) };
    // The same words again add nothing, whether they went or are waiting.
    if (this.#waiting ? this.#waiting.text === text : this.#last?.text === text) return;
    const since = this.#last ? this.now() - this.#last.at : Infinity;
    if (since >= this.everyMs && !this.#waiting) {
      this.#send(line);
      return;
    }
    this.#waiting = line;
    if (this.#timer) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        const next = this.#waiting;
        this.#waiting = undefined;
        if (next && next.text !== this.#last?.text) this.#send(next);
      },
      Math.max(0, this.everyMs - since),
    );
    this.#timer.unref?.();
  }

  close(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#waiting = undefined;
  }

  #send(line: NarrationLine) {
    this.#last = { text: line.text, at: this.now() };
    try {
      this.emit(line);
    } catch {
      // A line that couldn't be logged is a line not said: the turn goes on.
    }
  }
}

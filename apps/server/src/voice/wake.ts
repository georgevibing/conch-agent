/**
 * "Hey Conch" (ADR 0078), off until the person turns it on, read only ever
 * on the computer Conch runs on. The phrase follows the assistant's name
 * ("Hey Pearl"; "Hey Conch" always works too).
 *
 * Two ways to listen (ADR 0108):
 * - the desktop app's window, even while it's closed, shown in the tray;
 * - any other device (a phone) only while Conch is open and in front on it:
 *   the page says so here every 45 seconds (`state(on, who)`), and a burst
 *   from a device that hasn't is never read.
 *
 * The app's window listens with the microphone and a voice-activity gate;
 * when it hears a short burst of speech (a third of a second to under four),
 * it sends just that here as a WAV. whisper.cpp, already here for private
 * listening, reads it (told to expect someone talking to Conch), and the
 * words are matched against the phrase. Nothing is kept: the recording is deleted the
 * moment it's read, as dictation's is, and only "heard it or not" goes back.
 *
 * The app shows that it's listening in its window and in the tray (the
 * window says so here: `state`), and a press on "Stop listening" in the
 * tray turns it off on the page too (`wake.stop`). If the window stops
 * saying it's listening (it crashed, it was closed), the tray stops saying
 * so a minute later.
 */
import type { WakeResult } from '@conch/protocol';

import type { VoiceService } from './service';

/**
 * What whisper.cpp is told to expect. Not the phrase itself: given "Hey
 * Conch." as its prompt it leaves the phrase out of what it writes, taking it
 * for what came before (tried on this computer, ADR 0078).
 */
export const PROMPT = 'Talking to an assistant called Conch:';

/** What whisper.cpp is told to expect when the assistant has a name of its own. */
export const promptFor = (name: string): string =>
  callable(name) ? `Talking to an assistant called ${callable(name)}:` : PROMPT;

const GREETING = String.raw`^[\s"“'(]*(?:hey|hi|hay|heh|okay|ok|hello)[\s,.!-]*`;
const CONCH = String.raw`(?:conch|konch|conk|konk|conche|conch's|conchy|kontsch|konsch|caunch|kaunch)`;

/**
 * The part of an assistant's name a person would say: letters only, its
 * first two words, accents kept as written. Undefined when that's "Conch"
 * or nothing sayable (an emoji, a number).
 */
export function callable(name: string): string | undefined {
  const words = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2);
  const said = words.join(' ').slice(0, 40);
  return said && said.toLowerCase() !== 'conch' ? said : undefined;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One letter of a name, as written or without its accent: "Zoë" is heard as "Zoe" too. */
const letter = (c: string) => {
  const bare = c.normalize('NFD').replace(/\p{M}/gu, '');
  return bare && bare !== c ? `(?:${escape(c)}|${escape(bare)})` : escape(c);
};

function phrase(name?: string): RegExp {
  const own = name && callable(name);
  const spoken = own
    ? own
        .split(' ')
        .map((word) => [...word].map(letter).join(''))
        .join(String.raw`[\s,.-]*`)
    : undefined;
  const who = spoken ? `(?:${CONCH}|${spoken})` : CONCH;
  return new RegExp(`${GREETING}${who}(?![\\p{L}])[\\s,.!?"”-]*`, 'iu');
}

/** Whether `text` says "Hey Conch" (or "Hey <name>"), and what was said after it. */
export function heardWake(text: string, name?: string): WakeResult {
  text = text.normalize('NFC');
  const match = phrase(name).exec(text);
  if (!match) return { heard: false };
  const rest = text
    .slice(match.index + match[0].length)
    .replace(/^[\s,.!?-]+/, '')
    .trim();
  return rest ? { heard: true, rest } : { heard: true };
}

/** At most this much of a burst is read: "Hey Conch, what's the time?" fits. */
export const WAKE_SECONDS = 4;
const WAKE_BYTES = 16_000 * 2 * WAKE_SECONDS + 44;

/** The page says it's listening at least this often while it is. */
const HEARTBEAT_MS = 60_000;

/** Devices listening while Conch is open on them, at most (a phone, a tablet…). */
const MAX_OPEN = 8;

export interface WakeApp {
  send(message: { type: 'wake'; on: boolean } | { type: 'show' }): Promise<boolean>;
}

export class WakeWord {
  #checking = false;
  #on = false;
  #timer?: NodeJS.Timeout;
  /** Devices listening while Conch is open on them, and until when they said so. */
  readonly #open = new Map<string, number>();

  constructor(
    private readonly deps: {
      /** The desktop app this gateway runs in, if it does: it listens with the window closed. */
      app?: WakeApp;
      voice: Pick<VoiceService, 'transcribe'>;
      /** The assistant's name, which the phrase follows (the default agent's, ADR 0101). */
      name?: () => Promise<string>;
      now?: () => number;
    },
  ) {}

  /** The name the phrase follows. */
  async name(): Promise<string> {
    return (await this.deps.name?.().catch(() => undefined)) ?? 'Conch';
  }

  /**
   * A device listening only while Conch is open on it says so, and again
   * every 45 seconds; it counts as listening for a minute after the last.
   */
  open(who: string, on: boolean): void {
    const now = (this.deps.now ?? Date.now)();
    for (const [key, until] of this.#open) if (until <= now) this.#open.delete(key);
    if (!on) {
      this.#open.delete(who);
      return;
    }
    if (!this.#open.has(who) && this.#open.size >= MAX_OPEN) return;
    this.#open.set(who, now + HEARTBEAT_MS + 15_000);
  }

  #listening(who: string | undefined): boolean {
    if (this.#on && !who) return true;
    const until = who ? this.#open.get(who) : undefined;
    return until !== undefined && until > (this.deps.now ?? Date.now)();
  }

  get available(): boolean {
    return Boolean(this.deps.app);
  }

  get listening(): boolean {
    return this.#on;
  }

  /** The window says whether it's listening; the tray shows it, and forgets it if the window goes quiet. */
  async state(on: boolean): Promise<void> {
    if (!this.deps.app) return;
    clearTimeout(this.#timer);
    if (on) {
      this.#timer = setTimeout(() => void this.state(false), HEARTBEAT_MS + 15_000);
      this.#timer.unref?.();
    }
    if (on === this.#on) return;
    this.#on = on;
    await this.deps.app.send({ type: 'wake', on });
  }

  /**
   * Read one burst of speech. Only while the window says it's listening,
   * and one at a time: a burst that arrives while another is read is
   * dropped, so a noisy room can't queue up work.
   */
  async check(wav: Uint8Array, who?: string): Promise<WakeResult> {
    if (!this.#listening(who) || this.#checking || wav.byteLength > WAKE_BYTES)
      return { heard: false };
    this.#checking = true;
    try {
      const name = await this.name();
      const text = await this.deps.voice.transcribe(wav, 'auto', WAKE_BYTES, promptFor(name));
      const result = heardWake(text, name);
      // The desktop app's window comes forward; a phone is already in front of you.
      if (result.heard && !who) await this.deps.app?.send({ type: 'show' });
      return result;
    } finally {
      this.#checking = false;
    }
  }

  stop(): void {
    clearTimeout(this.#timer);
  }
}

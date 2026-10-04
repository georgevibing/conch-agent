/**
 * "Hey Conch" (ADR 0078), in the desktop app only, off until the person
 * turns it on, and only ever on this computer.
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

/** "Hey Conch" at the start of what was said, as whisper.cpp may write it down. */
const PHRASE =
  /^[\s"“'(]*(?:hey|hi|hay|heh|okay|ok|hello)[\s,.!-]*(?:conch|konch|conk|konk|conche|conch's|conchy|kontsch|konsch|caunch|kaunch)\b[\s,.!?"”-]*/i;

/** Whether `text` says "Hey Conch", and what was said after it. */
export function heardWake(text: string): WakeResult {
  const match = PHRASE.exec(text);
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

export interface WakeApp {
  send(message: { type: 'wake'; on: boolean } | { type: 'show' }): Promise<boolean>;
}

export class WakeWord {
  #checking = false;
  #on = false;
  #timer?: NodeJS.Timeout;

  constructor(
    private readonly deps: {
      /** The desktop app this gateway runs in, if it does: "Hey Conch" is only there. */
      app?: WakeApp;
      voice: Pick<VoiceService, 'transcribe'>;
    },
  ) {}

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
  async check(wav: Uint8Array): Promise<WakeResult> {
    if (!this.#on || this.#checking || wav.byteLength > WAKE_BYTES) return { heard: false };
    this.#checking = true;
    try {
      const text = await this.deps.voice.transcribe(wav, 'auto', WAKE_BYTES, PROMPT);
      const result = heardWake(text);
      if (result.heard) await this.deps.app?.send({ type: 'show' });
      return result;
    } finally {
      this.#checking = false;
    }
  }

  stop(): void {
    clearTimeout(this.#timer);
  }
}

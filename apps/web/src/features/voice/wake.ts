/**
 * Listening for "Hey Conch" in the desktop app (ADR 0078). The window keeps
 * the microphone open (echo cancellation and noise suppression on) and cuts
 * what it hears into short bursts of speech; each burst, and nothing else,
 * goes to the computer Conch runs on (the same computer: the desktop app
 * carries its own Conch), where whisper.cpp says whether it was the phrase.
 * Nothing is recorded or kept: a burst lives in memory until it's sent.
 */

/**
 * What a person says to call it: "Hey" and the assistant's name, its first
 * two words of letters (ADR 0108); "Hey Conch" when there's nothing sayable.
 * The gateway hears "Hey Conch" too, always (`voice/wake.ts`).
 */
export function wakePhrase(name: string | undefined): string {
  const said = (name ?? '')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .join(' ')
    .slice(0, 40);
  return `“Hey ${said || 'Conch'}”`;
}

/**
 * On a phone it listens only while Conch is open and on screen, and stops by
 * itself after this long without hearing the phrase, to spare the battery.
 */
export const OPEN_IDLE_MS = 5 * 60_000;

/** A burst this long can be "Hey Conch"; shorter is a click, longer is talk. */
export const BURST = { minMs: 350, maxMs: 3_600, quietMs: 350, prerollMs: 300 };

/**
 * Cuts a stream of samples into bursts of speech: louder than the room
 * (the quietest it's been lately, rising slowly), with a little of what came
 * just before, ended by a pause or a length limit.
 */
export class BurstCutter {
  #floor: number | undefined;
  #pre: Float32Array[] = [];
  #preLength = 0;
  #burst: Float32Array[] | undefined;
  #burstLength = 0;
  /** How much of the burst is what came before it. */
  #preroll = 0;
  #quiet = 0;
  /** Talk ran past the limit: nothing starts again until a pause. */
  #cooldown = false;

  constructor(private readonly rate: number) {}

  /** A chunk of samples; a finished burst when this one ends it. */
  push(chunk: Float32Array): Float32Array | undefined {
    let sum = 0;
    for (const s of chunk) sum += s * s;
    const level = Math.sqrt(sum / Math.max(1, chunk.length));
    const ms = (samples: number) => (samples / this.rate) * 1000;
    // The room: the quietest it's been, rising over about ten seconds, so a voice never becomes it.
    this.#floor =
      this.#floor === undefined || level < this.#floor
        ? level
        : this.#floor + (level - this.#floor) * Math.min(1, ms(chunk.length) / 10_000);
    const loud = level > Math.max(0.012, this.#floor * 3);

    if (this.#cooldown) {
      this.#quiet = loud ? 0 : this.#quiet + chunk.length;
      if (ms(this.#quiet) >= BURST.quietMs) this.#cooldown = false;
      return undefined;
    }
    if (!this.#burst) {
      if (loud) {
        this.#burst = [...this.#pre, chunk];
        this.#burstLength = this.#preLength + chunk.length;
        this.#preroll = this.#preLength;
        this.#quiet = 0;
        this.#pre = [];
        this.#preLength = 0;
        return undefined;
      }
      // A little of what came before, so the burst starts with its first sound.
      this.#pre.push(chunk);
      this.#preLength += chunk.length;
      while (
        this.#pre.length > 1 &&
        ms(this.#preLength - (this.#pre[0]?.length ?? 0)) >= BURST.prerollMs
      )
        this.#preLength -= this.#pre.shift()?.length ?? 0;
      return undefined;
    }

    this.#burst.push(chunk);
    this.#burstLength += chunk.length;
    this.#quiet = loud ? 0 : this.#quiet + chunk.length;
    const tooLong = ms(this.#burstLength) > BURST.maxMs;
    if (!tooLong && ms(this.#quiet) < BURST.quietMs) return undefined;
    const parts = this.#burst;
    const speech = this.#burstLength - this.#quiet - this.#preroll;
    this.#burst = undefined;
    this.#burstLength = 0;
    this.#quiet = 0;
    // Talk that ran past the limit isn't a call (nor is the rest of it); a click isn't either.
    if (tooLong) {
      this.#cooldown = true;
      return undefined;
    }
    if (ms(speech) < BURST.minMs) return undefined;
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

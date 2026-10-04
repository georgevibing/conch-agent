/**
 * Hearing someone start to talk over the assistant (ADR 0077 § 5): barge-in.
 *
 * The microphone stays open while the assistant speaks, with the browser's
 * echo cancellation, noise suppression and gain control on, so what comes
 * out of the speakers is mostly taken back out of what goes in. What's left
 * is judged by `SpeechGate`, a small voice-activity detector:
 *
 * - **Only the voice band.** Energy between 250 Hz and 3.8 kHz, where speech
 *   is; a fan or a hum below it, hiss above it, count for little.
 * - **Against the room.** A noise floor follows the quiet moments, and only
 *   clearly above it counts.
 * - **Against its own echo.** While the assistant speaks, the gate learns how
 *   loud what leaks back is (a device voice the browser can't cancel leaks
 *   more), and a person has to be clearly louder than that.
 * - **Long enough to be a word.** About a quarter of a second of it, with
 *   short dips allowed: a cough, a click or a door doesn't interrupt.
 */

export interface GateOptions {
  /** How long it must sound like speech before it counts, in ms. */
  minSpeechMs?: number;
  /** Short dips inside a word that don't reset it, in ms. */
  holdMs?: number;
  /** How far above the room a voice must be. */
  overNoise?: number;
  /** How far above the assistant's own leak a voice must be. */
  overEcho?: number;
  /** Below this, it's never speech (0–1). */
  floor?: number;
  /** How long its own voice is listened to before anything counts, in ms. */
  learnEchoMs?: number;
}

/** Decides, frame by frame, when someone has started talking. */
export class SpeechGate {
  #noise: number | undefined;
  #echo = 0;
  #echoSince: number | undefined;
  #since: number | undefined;
  #lastLoud = 0;
  /** It said "speech" for this stretch already. */
  #fired = false;
  readonly #o: Required<GateOptions>;

  constructor(options: GateOptions = {}) {
    this.#o = {
      minSpeechMs: 260,
      holdMs: 120,
      overNoise: 3,
      overEcho: 2.2,
      floor: 0.02,
      learnEchoMs: 300,
      ...options,
    };
  }

  /** The level a voice has to pass right now. */
  threshold(echo: boolean): number {
    const room = Math.max(this.#o.floor, (this.#noise ?? 0) * this.#o.overNoise);
    return echo ? Math.max(room, this.#echo * this.#o.overEcho) : room;
  }

  /**
   * One frame: the voice band's level (0–1) at `now` (ms), and whether the
   * assistant is speaking. True the moment it's speech, then not again until
   * it's been quiet.
   */
  push(level: number, now: number, echo: boolean): boolean {
    // The room: the quietest it's been lately, rising only slowly, so a
    // steady fan becomes the floor in a few seconds and a voice never does.
    this.#noise =
      this.#noise === undefined || level < this.#noise
        ? level
        : this.#noise + (level - this.#noise) * 0.004;
    if (echo) {
      // Its first moments teach the gate how loud its own leak is.
      this.#echoSince ??= now;
      if (now - this.#echoSince < this.#o.learnEchoMs) {
        this.#echo = Math.max(this.#echo, level);
        return false;
      }
    } else this.#echoSince = undefined;
    const threshold = this.threshold(echo);
    if (level <= threshold) {
      if (echo) this.#echo = Math.max(this.#echo * 0.998, level);
      if (now - this.#lastLoud > this.#o.holdMs) {
        this.#since = undefined;
        this.#fired = false;
      }
      return false;
    }
    this.#lastLoud = now;
    this.#since ??= now;
    if (!this.#fired && now - this.#since >= this.#o.minSpeechMs) {
      this.#fired = true;
      return true;
    }
    return false;
  }

  /** The assistant started speaking: what leaks back is measured afresh. */
  speaking(): void {
    this.#echo = 0;
    this.#echoSince = undefined;
    this.#since = undefined;
    this.#fired = false;
  }
}

/** The voice band's level in an analyser's frequency frame (dB), 0–1. */
export function voiceBand(
  frame: Float32Array,
  sampleRate: number,
  fftSize: number,
  band: [number, number] = [250, 3_800],
): number {
  const hz = sampleRate / fftSize;
  const from = Math.max(1, Math.floor(band[0] / hz));
  const to = Math.min(frame.length - 1, Math.ceil(band[1] / hz));
  let power = 0;
  for (let i = from; i <= to; i++) power += 10 ** ((frame[i] ?? -100) / 10);
  const mean = power / Math.max(1, to - from + 1);
  // -80 dB is silence, -20 dB a voice close to the microphone.
  const db = 10 * Math.log10(mean || 1e-10);
  return Math.min(1, Math.max(0, (db + 80) / 60));
}

export interface BargeIn {
  stop(): void;
}

/**
 * Listen for someone starting to talk while the assistant speaks. `echo()`
 * says whether it's speaking right now. Resolves once the microphone is
 * open; throws a sentence when it can't be.
 */
export async function watchForBargeIn(options: {
  onSpeech: () => void;
  echo: () => boolean;
  onLevel?: (level: number) => void;
}): Promise<BargeIn> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  const frame = new Float32Array(analyser.frequencyBinCount);
  const gate = new SpeechGate();
  let wasEcho = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    analyser.getFloatFrequencyData(frame);
    const level = voiceBand(frame, context.sampleRate, analyser.fftSize);
    const echo = options.echo();
    if (echo && !wasEcho) gate.speaking();
    wasEcho = echo;
    options.onLevel?.(level);
    if (gate.push(level, performance.now(), echo)) options.onSpeech();
  }, 20);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
    },
  };
}

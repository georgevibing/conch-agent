/**
 * A soft kitchen chime from Web Audio: three bell-like notes, rising, twice.
 * Nothing to download. Browsers only let a page make sound after a press, so
 * `primeChime` wakes the audio on the press that starts a timer.
 */

type AudioContextLike = AudioContext;
let context: AudioContextLike | undefined;

function audio(): AudioContextLike | undefined {
  if (context) return context;
  if (typeof window === 'undefined') return undefined;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  try {
    context = new Ctor();
  } catch {
    return undefined;
  }
  return context;
}

/** Wakes the audio while a press is happening, so the chime can play later. */
export function primeChime() {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}

function bell(ctx: AudioContextLike, frequency: number, at: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
  gain.connect(ctx.destination);
  // A sine and its soft octave make a small bell, not a beep.
  for (const [ratio, level] of [
    [1, 1],
    [2.01, 0.25],
  ] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * ratio, at);
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + 1.5);
  }
}

/** Plays the chime, if this browser can make sound. Never throws. */
export function chime() {
  try {
    const ctx = audio();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t = ctx.currentTime + 0.05;
    for (const round of [0, 1.6])
      [659.25, 830.61, 987.77].forEach((f, i) => bell(ctx, f, t + round + i * 0.16));
  } catch {
    // No sound: the timer still says it's done.
  }
}

/**
 * A recording as private dictation wants it: 16 kHz, mono, 16-bit PCM WAV
 * (ADR 0027). Whatever the browser recorded (Opus in Chrome, AAC in Safari)
 * is decoded and resampled here, so the computer needs no converter.
 */
export const RATE = 16_000;

/** Average the channels and resample (linear interpolation is plenty for speech). */
export function toMono16k(channels: Float32Array[], rate: number): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels)
    for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels.length;
  if (rate === RATE) return mono;
  const ratio = rate / RATE;
  const out = new Float32Array(Math.floor(length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const j = Math.floor(at);
    const frac = at - j;
    out[i] = (mono[j] ?? 0) * (1 - frac) + (mono[j + 1] ?? mono[j] ?? 0) * frac;
  }
  return out;
}

export function encodeWav(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** Loudness of a frame, 0–1, for the pearl and for noticing silence. */
export function level(frame: Uint8Array): number {
  let sum = 0;
  for (const v of frame) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, frame.length)) * 4);
}

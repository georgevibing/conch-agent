/**
 * A phone call's audio (ADR 0138): Twilio's Media Streams carry 8 kHz
 * μ-law (G.711), 20 ms a message. Conch hears with whisper.cpp at 16 kHz and
 * speaks with the reply voice at whatever rate it has, so this turns one
 * into the other, in memory, with no program in between, and tells speech
 * from silence (a small energy-based voice activity detector).
 *
 * Telephone audio is narrow (300–3400 Hz) and the caller's phone cancels its
 * own echo, so a simple detector and linear resampling are enough here.
 */

const BIAS = 0x84;
const CLIP = 32_635;

/** One μ-law byte as a 16-bit sample (ITU-T G.711). */
export function ulawToSample(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -magnitude : magnitude;
}

/** One 16-bit sample as a μ-law byte (ITU-T G.711). */
export function sampleToUlaw(sample: number): number {
  let s = Math.max(-32_768, Math.min(32_767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const DECODE = Int16Array.from({ length: 256 }, (_, b) => ulawToSample(b));

export function decodeUlaw(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i] ?? 0xff] ?? 0;
  return out;
}

export function encodeUlaw(samples: Int16Array): Buffer {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = sampleToUlaw(samples[i] ?? 0);
  return out;
}

/**
 * Samples at another rate, by linear interpolation; going down, each output
 * sample averages what it covers, so speech at 22 kHz doesn't alias into the
 * telephone band.
 */
export function resample(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to || !samples.length) return samples;
  const ratio = from / to;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const at = i * ratio;
    if (ratio > 1) {
      const start = Math.floor(at);
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor(at + ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j] ?? 0;
      out[i] = Math.round(sum / (end - start));
    } else {
      const j = Math.floor(at);
      const frac = at - j;
      const a = samples[j] ?? 0;
      const b = samples[Math.min(samples.length - 1, j + 1)] ?? a;
      out[i] = Math.round(a + (b - a) * frac);
    }
  }
  return out;
}

/** 16-bit mono samples as a WAV. */
export function wavFrom(samples: Int16Array, rate: number): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * A WAV's samples and rate: 16-bit PCM, mono (a voice speaks in one channel;
 * a second one is dropped). Undefined for anything else.
 */
export function samplesOf(wav: Buffer): { samples: Int16Array; rate: number } | undefined {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  if (wav.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let offset = 12;
  let rate = 0;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      if (wav.readUInt16LE(offset + 8) !== 1) return undefined;
      channels = wav.readUInt16LE(offset + 10);
      rate = wav.readUInt32LE(offset + 12);
      bits = wav.readUInt16LE(offset + 22);
    }
    if (id === 'data') {
      if (bits !== 16 || !rate || channels < 1) return undefined;
      const end = Math.min(wav.length, offset + 8 + size);
      const bytes = wav.subarray(offset + 8, end - ((end - offset - 8) % (2 * channels)));
      const all = new Int16Array(bytes.length / 2);
      for (let i = 0; i < all.length; i++) all[i] = bytes.readInt16LE(i * 2);
      if (channels === 1) return { samples: all, rate };
      const mono = new Int16Array(Math.floor(all.length / channels));
      for (let i = 0; i < mono.length; i++) mono[i] = all[i * channels] ?? 0;
      return { samples: mono, rate };
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

/** How loud a frame is (root mean square). */
export function loudness(samples: Int16Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

export interface Detected {
  /** Speech started in this frame (after enough loud frames in a row). */
  started: boolean;
  /** The words ended: enough quiet after speech. */
  ended: boolean;
  /** This frame counts as speech. */
  speech: boolean;
}

/**
 * Speech and silence, frame by frame (20 ms each). The floor follows the
 * line's own noise, so a car's hum isn't speech; speech is a few loud frames
 * in a row, and it's over after `endFrames` quiet ones.
 */
export class SpeechDetector {
  #floor = 120;
  #loud = 0;
  #quiet = 0;
  #inSpeech = false;

  constructor(
    private readonly options: {
      /** Loud frames in a row before it's speech (3: 60 ms). */
      startFrames?: number;
      /** Quiet frames in a row that end it (40: 800 ms). */
      endFrames?: number;
      /** How far above the floor speech is. */
      factor?: number;
      /** Never quieter than this to count as speech. */
      minimum?: number;
    } = {},
  ) {}

  get speaking() {
    return this.#inSpeech;
  }

  reset() {
    this.#loud = 0;
    this.#quiet = 0;
    this.#inSpeech = false;
  }

  /** `strict`: while Conch speaks, only clearly louder speech counts (barge-in). */
  frame(samples: Int16Array, strict = false): Detected {
    const level = loudness(samples);
    const factor = (this.options.factor ?? 3) * (strict ? 2 : 1);
    const threshold = Math.max(this.options.minimum ?? 400, this.#floor * factor);
    const speech = level > threshold;
    // The floor drifts toward quiet frames quickly and toward loud ones slowly.
    if (!speech) this.#floor = this.#floor * 0.95 + level * 0.05;
    else this.#floor = this.#floor * 0.999 + level * 0.001;
    this.#floor = Math.max(40, Math.min(this.#floor, 4_000));
    let started = false;
    let ended = false;
    if (speech) {
      this.#loud++;
      this.#quiet = 0;
      const needed = (this.options.startFrames ?? 3) * (strict ? 2 : 1);
      if (!this.#inSpeech && this.#loud >= needed) {
        this.#inSpeech = true;
        started = true;
      }
    } else {
      this.#loud = 0;
      if (this.#inSpeech && ++this.#quiet >= (this.options.endFrames ?? 40)) {
        this.#inSpeech = false;
        this.#quiet = 0;
        ended = true;
      }
    }
    return { started, ended, speech };
  }
}

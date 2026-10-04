/**
 * Turning one kind of audio into another with FFmpeg, on this computer
 * (ADR 0077): a voice note (Opus, AAC, AMR…) into the 16 kHz WAV whisper.cpp
 * reads, and a spoken answer into the voice note a chat app plays.
 *
 * A voice note is untrusted bytes from a stranger's phone, and FFmpeg can do
 * far more than decode audio: an HLS playlist, a concat list or a `subfile:`
 * URL can make it read other files on this computer (Conch's keys) and decode
 * them into the output. So nothing about the input decides what FFmpeg does:
 *
 * - **Sniffed, then forced.** Conch reads the first bytes itself and accepts
 *   only real audio containers (`sniffAudio`): Ogg, WAV, MP4/M4A/3GP, CAF,
 *   AMR, MP3, ADTS AAC, Matroska/WebM, FLAC. Anything else is refused before
 *   FFmpeg runs. FFmpeg is then told that demuxer (`-f`), never probes, and
 *   may open no other (`-format_whitelist` of exactly these).
 * - **No files at all.** The input goes in on stdin and the result comes out
 *   on stdout (`pipe:0`, `pipe:1`, `-protocol_whitelist pipe`): there is no
 *   file protocol for anything inside it to reach, and nothing is written to
 *   disk, so nothing can be left behind.
 * - **Capped.** At most `MAX_NOTE_BYTES` in, the first ten minutes out, the
 *   output's size capped too, and killed past its time limit.
 */
import { spawn as nodeSpawn } from 'node:child_process';

import { agentEnv } from '../lib/proc';

export type { RunResult } from '../lib/proc';
import type { RunResult } from '../lib/proc';

export type Exec = (file: string, args: string[], timeout: number) => Promise<RunResult>;

/**
 * FFmpeg with bytes in on stdin and bytes out on stdout. Tests stand in for
 * it; the real one is `pipeThrough`.
 */
export type Pipe = (
  file: string,
  args: string[],
  input: Uint8Array,
  options: { timeout: number; maxOut: number },
) => Promise<{ code?: number; stdout: Buffer; stderr: string }>;

/** What a chat app plays as a voice note. */
export type NoteFormat = 'ogg' | 'aac';

/** The most a voice note may be: ten minutes of any codec a chat app uses fits easily. */
export const MAX_NOTE_BYTES = 20 * 1024 * 1024;

/** The demuxers FFmpeg may use: exactly the containers `sniffAudio` accepts. */
export const AUDIO_DEMUXERS = [
  'ogg',
  'wav',
  'mov',
  'caf',
  'amr',
  'mp3',
  'aac',
  'matroska',
  'flac',
] as const;
export type AudioDemuxer = (typeof AUDIO_DEMUXERS)[number];

const ascii = (b: Uint8Array, from: number, to: number) =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1', from, to);

/**
 * The container a voice note really is, from its first bytes (never its
 * name or the type the app claimed); undefined for anything else.
 */
export function sniffAudio(bytes: Uint8Array): AudioDemuxer | undefined {
  if (bytes.length < 12) return undefined;
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return 'wav';
  // MP4, M4A, 3GP: a box, `ftyp`, then a brand.
  if (ascii(bytes, 4, 8) === 'ftyp') return 'mov';
  if (ascii(bytes, 0, 4) === 'caff') return 'caf';
  if (ascii(bytes, 0, 5) === '#!AMR') return 'amr';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'matroska';
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  // A frame sync: ADTS AAC has layer bits 00, MPEG audio (MP3) doesn't.
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
    return ((bytes[1] ?? 0) & 0x06) === 0 ? 'aac' : 'mp3';
  return undefined;
}

const QUIET = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
/** Only stdin and stdout: nothing inside the input can name a file or an address. */
const PIPES = ['-protocol_whitelist', 'pipe'];
const ONLY_AUDIO = ['-format_whitelist', AUDIO_DEMUXERS.join(',')];

/** The real pipe: FFmpeg as a child, no shell, killed past its time or output cap. */
export const pipeThrough: Pipe = (file, args, input, options) =>
  new Promise((resolve) => {
    const child = nodeSpawn(file, args, {
      env: agentEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let killed = false;
    const kill = () => {
      killed = true;
      child.kill();
    };
    const timer = setTimeout(kill, options.timeout);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxOut) kill();
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.alloc(0), stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ...(!killed && code !== null && { code }),
        stdout: Buffer.concat(out),
        stderr: killed ? 'It took too long, or made too much.' : stderr,
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });

async function through(
  options: { ffmpeg: string; pipe?: Pipe },
  input: Uint8Array,
  demuxer: AudioDemuxer,
  outputArgs: string[],
  maxOut: number,
): Promise<Buffer> {
  const result = await (options.pipe ?? pipeThrough)(
    options.ffmpeg,
    [...QUIET, ...PIPES, ...ONLY_AUDIO, '-f', demuxer, '-i', 'pipe:0', ...outputArgs, 'pipe:1'],
    input,
    { timeout: 60_000, maxOut },
  );
  if (result.code !== 0 || !result.stdout.length)
    throw new AudioError(
      result.stderr.trim().split('\n').pop()?.slice(0, 200) || 'FFmpeg gave no reason.',
    );
  return result.stdout;
}

/**
 * A voice note as a 16 kHz mono 16-bit WAV, at most `seconds` long. Refused
 * before FFmpeg runs unless it's a real audio container of a sane size.
 */
export function toWav16k(
  options: { ffmpeg: string; pipe?: Pipe },
  input: Uint8Array,
  seconds: number,
): Promise<Buffer> {
  if (input.byteLength > MAX_NOTE_BYTES)
    return Promise.reject(new AudioError('That voice note is too big.'));
  const demuxer = sniffAudio(input);
  if (!demuxer) return Promise.reject(new AudioError('That isn’t a recording Conch can read.'));
  return through(
    options,
    input,
    demuxer,
    [
      '-t',
      String(seconds),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-f',
      'wav',
    ],
    // Sixteen-bit 16 kHz mono for `seconds`, and a little for the header.
    32_000 * seconds + 4096,
  ).then(sized);
}

/**
 * A WAV written to a pipe can't go back to fill in its sizes; they're filled
 * in here, so every reader (whisper.cpp, `checkWav`) sees a plain WAV.
 */
export function sized(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') return wav;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') {
      const out = Buffer.from(wav);
      out.writeUInt32LE(wav.length - offset - 8, offset + 4);
      out.writeUInt32LE(wav.length - 8, 4);
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  return wav;
}

/** A WAV Conch made itself, as a voice note: Opus in Ogg (Telegram, WhatsApp, Discord) or AAC (Signal). */
export function toVoiceNote(
  options: { ffmpeg: string; pipe?: Pipe },
  wav: Uint8Array,
  format: NoteFormat,
): Promise<Buffer> {
  const codec =
    format === 'ogg'
      ? ['-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-application', 'voip', '-f', 'ogg']
      : // Raw ADTS, as Signal records its own voice notes.
        ['-c:a', 'aac', '-b:a', '48k', '-ar', '44100', '-f', 'adts'];
  return through(
    options,
    wav,
    'wav',
    ['-vn', '-ac', '1', ...codec, '-map_metadata', '-1'],
    MAX_NOTE_BYTES,
  );
}

/** How long a 16-bit mono WAV plays, in seconds (its data, after the header). */
export function wavSeconds(wav: Uint8Array): number {
  const b = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF') return 0;
  const rate = b.readUInt32LE(24) || 16_000;
  const channels = b.readUInt16LE(22) || 1;
  // Find the data chunk: FFmpeg and Piper may put others before it.
  let offset = 12;
  while (offset + 8 <= b.length) {
    const id = b.toString('ascii', offset, offset + 4);
    const size = b.readUInt32LE(offset + 4);
    // FFmpeg writing to a pipe can't go back to fill in sizes: the rest is the data.
    if (id === 'data')
      return (
        (size === 0xffffffff || size === 0
          ? b.length - offset - 8
          : Math.min(size, b.length - offset - 8)) /
        (rate * channels * 2)
      );
    offset += 8 + size + (size % 2);
  }
  return 0;
}

export class AudioError extends Error {}

import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Hearing } from '../../voice/service';
import { forTurn } from '../prompt';
import { AttachmentStore } from '../store';
import {
  clock,
  forgetJobs,
  frameTimes,
  media,
  parseFfmpegInfo,
  parseProbe,
  sniffMedia,
  type MediaDeps,
} from './media';
import type { ReaderInput } from './types';

/** A 16 kHz mono WAV this many seconds long, as FFmpeg would hand it over. */
function wav(seconds: number): Buffer {
  const data = Math.round(seconds * 32_000);
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16_000, 24);
  b.writeUInt32LE(32_000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  return b;
}

const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(200)]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.alloc(200),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const probeJson = (o: { seconds: number; video?: [number, number]; audio?: boolean }) =>
  JSON.stringify({
    format: { duration: String(o.seconds), tags: { TITLE: 'Weekly\u0007 sync', artist: 'Ada' } },
    streams: [
      ...(o.video
        ? [{ codec_type: 'video', width: o.video[0], height: o.video[1], disposition: {} }]
        : []),
      ...(o.audio === false ? [] : [{ codec_type: 'audio' }]),
    ],
  });

interface Fake {
  deps: MediaDeps;
  calls: string[][];
  heard: number[];
}

function fake(options: {
  probe: string;
  /** Seconds of sound in the whole file. */
  seconds: number;
  hearing?: Hearing;
  ffmpeg?: string | undefined;
  /** Hold transcription until this resolves. */
  hold?: Promise<void>;
}): Fake {
  const calls: string[][] = [];
  const heard: number[] = [];
  const deps: MediaDeps = {
    ffmpeg: async () => ('ffmpeg' in options ? options.ffmpeg : '/opt/ffmpeg'),
    ffprobe: async () => '/opt/ffprobe',
    hearing: async () => options.hearing ?? { ready: true },
    exec: async (file, args) => {
      calls.push([file, ...args]);
      return { code: 0, stdout: options.probe, stderr: '' };
    },
    pipe: async (file, args) => {
      calls.push([file, ...args]);
      if (args.includes('-frames:v')) return { code: 0, stdout: JPEG, stderr: '' };
      const from = Number(args[args.indexOf('-ss') + 1] ?? 0) || 0;
      const left = Math.min(600, options.seconds - from);
      return left > 0
        ? { code: 0, stdout: wav(left), stderr: '' }
        : { code: 0, stdout: Buffer.alloc(0), stderr: '' };
    },
    transcribe: async (bytes) => {
      await options.hold;
      heard.push(bytes.length);
      return heard.length === 1 ? 'Hello everyone.' : 'And that is all.';
    },
  };
  return { deps, calls, heard };
}

async function attach(name: string, bytes: Buffer) {
  const store = new AttachmentStore(await mkdtemp(join(tmpdir(), 'conch-media-')));
  const attachment = await store.save({ name, bytes });
  const found = await store.get(attachment.id);
  if (!found) throw new Error('not saved');
  return { store, attachment, path: found.path };
}

async function read(
  file: Awaited<ReturnType<typeof attach>>,
  deps: MediaDeps,
  images = true,
  signal = new AbortController().signal,
) {
  const bytes = file.attachment.name.endsWith('.mp4') ? MP4 : MP3;
  const input: ReaderInput = {
    attachment: file.attachment,
    bytes,
    path: file.path,
    room: 60_000,
    can: { images, files: false },
    deps: { media: deps },
    signal,
  };
  expect(media.matches(file.attachment, bytes)).toBe(true);
  return media.read(input);
}

afterEach(() => forgetJobs());

describe('media reader', () => {
  it('knows media by its bytes and reads its facts', () => {
    expect(sniffMedia(Buffer.from('RIFF\0\0\0\0AVI LIST', 'latin1'))).toBe('avi');
    expect(sniffMedia(MP3)).toBe('mp3');
    expect(sniffMedia(Buffer.from('not a recording at all'))).toBeUndefined();
    expect(parseProbe(probeJson({ seconds: 75.5, video: [1920, 1080] }))).toEqual({
      seconds: 75.5,
      video: { width: 1920, height: 1080 },
      audio: true,
      tags: { title: 'Weekly sync', artist: 'Ada' },
    });
    expect(
      parseFfmpegInfo(
        [
          "Input #0, mov,mp4, from 'file:/x.mp4':",
          '  Metadata:',
          '    title           : Holiday',
          '  Duration: 00:01:02.50, start: 0.000000, bitrate: 900 kb/s',
          '  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1280x720, 25 fps',
          '  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo',
          'At least one output file must be specified',
        ].join('\n'),
      ),
    ).toEqual({
      seconds: 62.5,
      video: { width: 1280, height: 720 },
      audio: true,
      tags: { title: 'Holiday' },
    });
    expect(frameTimes(30)).toEqual([5, 15, 25]);
    expect(frameTimes(3600)).toHaveLength(8);
    expect(frameTimes(undefined)).toEqual([0]);
    expect(clock(3723)).toBe('1:02:03');
  });

  it('hears a long recording ten minutes at a time, marked with times, and only once', async () => {
    const file = await attach('meeting.mp3', MP3);
    const f = fake({ probe: probeJson({ seconds: 700 }), seconds: 700 });
    const result = await read(file, f.deps);
    expect(result?.note).toContain('A recording, 11 min 40 s long.');
    expect(result?.note).toContain('heard on this computer');
    expect(result?.text).toContain('Title: Weekly sync');
    expect(result?.text).toContain('[0:00] Hello everyone.');
    expect(result?.text).toContain('[10:00] And that is all.');
    expect(result?.more).toBeUndefined();
    expect(f.heard).toHaveLength(2);

    // FFmpeg is told what the file is and may open nothing else; never a shell.
    const chunk = f.calls.find((c) => c.includes('pcm_s16le')) ?? [];
    expect(chunk).toEqual(expect.arrayContaining(['-nostdin', '-protocol_whitelist', 'file']));
    expect(chunk[chunk.indexOf('-f') + 1]).toBe('mp3');
    expect(chunk).toContain(`file:${file.path}`);

    // Kept beside the attachment: the next message doesn't hear it again.
    expect(await readdir(join(file.path, '..'))).toContain('.for-models-media.json');
    const again = fake({ probe: probeJson({ seconds: 700 }), seconds: 700 });
    expect((await read(file, again.deps))?.text).toContain('[10:00] And that is all.');
    expect(again.heard).toHaveLength(0);
    expect(again.calls).toHaveLength(0);
  });

  it('shows a video’s pictures with their times to a model that sees, and hears its sound', async () => {
    const file = await attach('clip.mp4', MP4);
    const f = fake({ probe: probeJson({ seconds: 30, video: [1920, 1080] }), seconds: 30 });
    const seeing = await read(file, f.deps);
    expect(seeing?.note).toContain('A video, 30 s long, 1920×1080.');
    expect(seeing?.note).toContain('3 pictures from it are shown to you');
    expect(seeing?.images).toHaveLength(3);
    expect(seeing?.images?.[0]).toMatchObject({ name: 'clip.mp4 at 0:05', mimeType: 'image/jpeg' });
    expect(seeing?.text).toContain('Pictures taken at: 0:05, 0:15, 0:25');
    expect(seeing?.text).toContain('[0:00] Hello everyone.');

    // A model that can't see gets the words, and is told the pictures aren't there.
    const blind = await read(file, f.deps, false);
    expect(blind?.images).toBeUndefined();
    expect(blind?.note).toContain("can't see");
    expect(blind?.text).toContain('Hello everyone.');
  });

  it('says what to get when whisper.cpp or its model isn’t here, and hears it once they are', async () => {
    const file = await attach('memo.mp3', MP3);
    const missing = fake({
      probe: probeJson({ seconds: 20 }),
      seconds: 20,
      hearing: { ready: false, need: 'whisper' },
    });
    const first = await read(file, missing.deps);
    expect(first?.note).toContain('needs whisper.cpp');
    expect(first?.note).toContain('Settings → Voice');
    expect(first?.note).toContain('say so');
    expect(missing.heard).toHaveLength(0);

    const model = fake({
      probe: probeJson({ seconds: 20 }),
      seconds: 20,
      hearing: { ready: false, model: 'missing' },
    });
    expect((await read(file, model.deps))?.note).toContain('speech model');

    const ready = fake({ probe: probeJson({ seconds: 20 }), seconds: 20 });
    expect((await read(file, ready.deps))?.text).toContain('Hello everyone.');
  });

  it('names FFmpeg as what to get when it isn’t here', async () => {
    const file = await attach('memo.mp3', MP3);
    const f = fake({ probe: '', seconds: 0, ffmpeg: undefined });
    const result = await read(file, f.deps);
    expect(result?.note).toContain('FFmpeg');
    expect(result?.note).toContain('Settings → Voice');
    expect(f.calls).toHaveLength(0);
  });

  it('goes with what it has when the turn can’t wait, and keeps listening for the next', async () => {
    const file = await attach('talk.mp3', MP3);
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const f = fake({ probe: probeJson({ seconds: 20 }), seconds: 20, hold });
    const stop = new AbortController();
    const reading = read(file, f.deps, true, stop.signal);
    setTimeout(() => stop.abort(), 20);
    const early = await reading;
    expect(early?.note).toContain('listening to it on this computer');
    expect(early?.more).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const later = await read(file, fake({ probe: '', seconds: 0 }).deps);
    expect(later?.text).toContain('Hello everyone.');
  });

  it('reaches engines that open files themselves too, through forTurn', async () => {
    const file = await attach('memo.mp3', MP3);
    const f = fake({ probe: probeJson({ seconds: 20 }), seconds: 20 });
    const turn = await forTurn(
      file.store,
      [file.attachment],
      { images: true, files: true },
      { media: f.deps },
    );
    expect(file.attachment.mimeType).toBe('audio/mpeg');
    expect(turn.block).toContain(`path="${file.path}"`);
    expect(turn.block).toContain('[0:00] Hello everyone.');
  });
});

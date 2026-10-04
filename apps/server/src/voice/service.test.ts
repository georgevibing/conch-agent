import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkWav,
  cleanTranscript,
  MAX_WAITING,
  MODEL,
  voiceDir,
  type VoiceError,
  VoiceService,
} from './service';

/** A WAV like the page makes: 16 kHz, mono, 16-bit. */
function wav(seconds = 1, rate = 16_000, channels = 1): Buffer {
  const samples = rate * seconds * channels;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(samples * 2, 40);
  return b;
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-voice-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('recordings', () => {
  it('reads only 16 kHz mono WAVs of a sensible length', () => {
    expect(checkWav(wav())).toBeUndefined();
    expect(checkWav(Buffer.from('not audio at all, honestly not'))).toMatch(/isn’t a recording/);
    expect(checkWav(wav(1, 44_100))).toMatch(/16 kHz mono/);
    expect(checkWav(wav(1, 16_000, 2))).toMatch(/16 kHz mono/);
    expect(checkWav(wav(301))).toMatch(/five minutes/);
  });

  it('cleans whisper.cpp’s markers out of the words', () => {
    expect(cleanTranscript(' [BLANK_AUDIO]\n Remind me to call Ada (music) tomorrow. ')).toBe(
      'Remind me to call Ada tomorrow.',
    );
  });
});

describe('transcribing', () => {
  const ready = () => {
    mkdirSync(voiceDir(home), { recursive: true });
    writeFileSync(join(voiceDir(home), MODEL.name), 'model');
  };

  it('runs whisper.cpp on the recording, then deletes it', async () => {
    ready();
    const exec = vi.fn(async (_file: string, args: string[]) => {
      const file = args[args.indexOf('-f') + 1] ?? '';
      expect(existsSync(file)).toBe(true);
      return { stdout: ' Hello there. \n', stderr: '', code: 0 };
    });
    const voice = new VoiceService({ home, whisper: async () => '/bin/whisper-cli', exec });
    expect(await voice.transcribe(wav(), 'en')).toBe('Hello there.');
    expect(exec.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-l', 'en', '-nt', '-np']));
    expect(readdirSync(join(voiceDir(home), 'tmp'))).toEqual([]);
  });

  it('never passes anything but a language code to whisper.cpp', async () => {
    ready();
    const exec = vi.fn(async (_file: string, _args: string[]) => ({
      stdout: 'x',
      stderr: '',
      code: 0,
    }));
    const voice = new VoiceService({ home, whisper: async () => '/bin/whisper-cli', exec });
    await voice.transcribe(wav(), '--model=/etc/passwd');
    expect(exec.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-l', 'auto']));
  });

  it('says what’s missing in words', async () => {
    const without = new VoiceService({ home, whisper: async () => undefined });
    await expect(without.transcribe(wav())).rejects.toThrow(/needs whisper\.cpp/);
    const noModel = new VoiceService({ home, whisper: async () => '/bin/whisper-cli' });
    await expect(noModel.transcribe(wav())).rejects.toThrow(/speech model/);
    expect((await noModel.status()).private.state).toBe('model-missing');
  });

  it('deletes the recording even when whisper.cpp fails', async () => {
    ready();
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      exec: async () => ({ stdout: '', stderr: 'error: failed to read', code: 1 }),
    });
    await expect(voice.transcribe(wav())).rejects.toThrow(/failed to read/);
    expect(readdirSync(join(voiceDir(home), 'tmp'))).toEqual([]);
  });

  it('leaves nothing behind when a voice note throws midway, and sweeps what a crash left', async () => {
    ready();
    const tmp = join(voiceDir(home), 'tmp');
    mkdirSync(tmp, { recursive: true });
    // A recording a crash left an hour ago, and one being read right now by another.
    const old = join(tmp, 'left-by-a-crash.wav');
    writeFileSync(old, 'x');
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(old, hourAgo, hourAgo);
    const fresh = join(tmp, 'being-read.wav');
    writeFileSync(fresh, 'x');
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      ffmpeg: async () => '/bin/ffmpeg',
      pipe: async () => ({ code: 0, stdout: wav(1), stderr: '' }),
      exec: async () => {
        throw new Error('whisper.cpp crashed');
      },
    });
    await expect(
      voice.transcribeNote(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)])),
    ).rejects.toThrow(/crashed/);
    expect(readdirSync(tmp)).toEqual(['being-read.wav']);
  });

  it('refuses more recordings than can wait their turn, so a flood can’t pile up', async () => {
    ready();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      exec: async () => {
        await gate;
        return { stdout: 'ok', stderr: '', code: 0 };
      },
    });
    const settled: string[] = [];
    const all = Array.from({ length: 2 + MAX_WAITING + 1 }, () =>
      voice
        .transcribe(wav())
        .then(
          () => 'heard',
          (error: VoiceError) => error.code,
        )
        .then((outcome) => {
          settled.push(outcome);
          return outcome;
        }),
    );
    // The one too many is told at once, while the others still wait.
    await vi.waitFor(() => expect(settled).toEqual(['busy']), { timeout: 10_000 });
    release();
    const outcomes = await Promise.all(all);
    expect(outcomes.filter((o) => o === 'busy')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'heard')).toHaveLength(2 + MAX_WAITING);
  });
});

describe('voice notes', () => {
  const ready = () => {
    mkdirSync(voiceDir(home), { recursive: true });
    writeFileSync(join(voiceDir(home), MODEL.name), 'model');
  };
  const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(100, 7)]);

  /** FFmpeg makes the WAV (on its stdout); whisper.cpp reads it. */
  function programs(options: { ffmpegFails?: boolean; seconds?: number } = {}) {
    const ran: { file: string; args: string[] }[] = [];
    const pipe = vi.fn(async (file: string, args: string[], _input: Uint8Array) => {
      ran.push({ file, args });
      if (options.ffmpegFails)
        return {
          stdout: Buffer.alloc(0),
          stderr: 'Invalid data found when processing input',
          code: 1,
        };
      // A few bytes past the samples, as FFmpeg's padding can leave.
      return {
        stdout: Buffer.concat([wav(options.seconds ?? 2), Buffer.alloc(3)]),
        stderr: '',
        code: 0,
      };
    });
    const exec = vi.fn(async (file: string, args: string[], _timeout: number) => {
      ran.push({ file, args });
      return { stdout: ' Call Ada back. \n', stderr: '', code: 0 };
    });
    return { exec, pipe, ran };
  }

  it('says what it needs to hear one: whisper.cpp, then FFmpeg, then the model', async () => {
    const none = new VoiceService({ home, whisper: async () => undefined });
    expect(await none.hearing()).toEqual({ ready: false, need: 'whisper' });
    const noFfmpeg = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      ffmpeg: async () => undefined,
    });
    expect(await noFfmpeg.hearing()).toEqual({ ready: false, need: 'ffmpeg' });
    // A WAV doesn't need FFmpeg.
    expect(await noFfmpeg.hearing(true)).toEqual({ ready: false, model: 'missing' });
    ready();
    expect(await noFfmpeg.hearing(true)).toEqual({ ready: true });
  });

  it('turns an Opus voice note into a WAV with FFmpeg, then into words, and keeps nothing', async () => {
    ready();
    const { exec, pipe, ran } = programs();
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      ffmpeg: async () => '/bin/ffmpeg',
      exec,
      pipe,
    });
    const heard = await voice.transcribeNote(OGG);
    expect(heard).toMatchObject({ text: 'Call Ada back.', cut: false });
    expect(heard.seconds).toBeCloseTo(2, 2);
    const ffmpeg = ran.find((r) => r.file === '/bin/ffmpeg');
    // Fixed arguments, through pipes only, the sniffed demuxer and no other,
    // at most ten minutes, 16 kHz mono.
    expect(ffmpeg?.args.join(' ')).toContain(
      '-protocol_whitelist pipe -format_whitelist ogg,wav,mov,caf,amr,mp3,aac,matroska,flac -f ogg -i pipe:0',
    );
    expect(ffmpeg?.args.at(-1)).toBe('pipe:1');
    expect(ffmpeg?.args).toEqual(expect.arrayContaining(['-t', '600', '-ar', '16000', '-ac', '1']));
    expect(readdirSync(join(voiceDir(home), 'tmp'))).toEqual([]);
    // Node only takes whole milliseconds: a WAV of any length gives one.
    for (const call of exec.mock.calls) expect(Number.isInteger(call[2])).toBe(true);
  });

  it('says when a voice note was longer than it reads', async () => {
    ready();
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      ffmpeg: async () => '/bin/ffmpeg',
      ...programs({ seconds: 600 }),
    });
    expect((await voice.transcribeNote(OGG)).cut).toBe(true);
  });

  it('names FFmpeg as what’s missing, and refuses what FFmpeg can’t read', async () => {
    ready();
    const without = new VoiceService({ home, whisper: async () => '/bin/whisper-cli' });
    await expect(without.transcribeNote(OGG)).rejects.toMatchObject({
      code: 'not-ready',
      need: 'ffmpeg',
    });
    const broken = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      ffmpeg: async () => '/bin/ffmpeg',
      ...programs({ ffmpegFails: true }),
    });
    await expect(broken.transcribeNote(OGG)).rejects.toMatchObject({ code: 'bad-audio' });
    // Nothing was written to disk at all.
    expect(existsSync(join(voiceDir(home), 'tmp'))).toBe(false);
  });

  it('reads a WAV voice note without FFmpeg', async () => {
    ready();
    const { exec, ran } = programs();
    const voice = new VoiceService({ home, whisper: async () => '/bin/whisper-cli', exec });
    expect((await voice.transcribeNote(wav(3))).text).toBe('Call Ada back.');
    expect(ran.every((r) => r.file !== '/bin/ffmpeg')).toBe(true);
  });

  it('runs whisper.cpp at most two at a time', async () => {
    ready();
    let running = 0;
    let most = 0;
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      exec: async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 20));
        running -= 1;
        return { stdout: 'ok', stderr: '', code: 0 };
      },
    });
    await Promise.all(Array.from({ length: 5 }, () => voice.transcribe(wav())));
    expect(most).toBe(2);
  });
});

describe('getting the speech model', () => {
  const model = Buffer.from('a pretend speech model, a few bytes long');
  const sha = createHash('sha256').update(model).digest('hex');

  function huggingFace(options: { sha?: string; resumeFrom?: number } = {}) {
    const calls: { method: string; range?: string }[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method: init?.method ?? 'GET', range: headers.range });
      if (init?.method === 'HEAD')
        return new Response(null, {
          status: 302,
          headers: {
            'x-linked-etag': `"${options.sha ?? sha}"`,
            'x-linked-size': String(model.length),
          },
        });
      const from = headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)?.[1]) : 0;
      return new Response(model.subarray(from), { status: from ? 206 : 200 });
    });
    return { fetcher: fetcher as unknown as typeof fetch, calls };
  }

  it('downloads it, checks it against Hugging Face’s SHA-256, and is ready', async () => {
    const { fetcher } = huggingFace();
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      fetch: fetcher,
    });
    await voice.getModel();
    await vi.waitFor(async () => expect((await voice.status()).private.state).toBe('ready'));
    expect(readFileSync(join(voiceDir(home), MODEL.name))).toEqual(model);
  });

  it('carries on from where a download stopped', async () => {
    mkdirSync(voiceDir(home), { recursive: true });
    writeFileSync(join(voiceDir(home), `${MODEL.name}.part`), model.subarray(0, 10));
    const { fetcher, calls } = huggingFace();
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      fetch: fetcher,
    });
    await voice.getModel();
    await vi.waitFor(async () => expect((await voice.status()).private.state).toBe('ready'));
    expect(calls.find((c) => c.method === 'GET')?.range).toBe('bytes=10-');
    expect(readFileSync(join(voiceDir(home), MODEL.name))).toEqual(model);
  });

  it('throws away a download that doesn’t match, and says so', async () => {
    const { fetcher } = huggingFace({ sha: 'f'.repeat(64) });
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      fetch: fetcher,
    });
    await voice.getModel();
    await vi.waitFor(async () => {
      const p = (await voice.status()).private;
      expect(p.state === 'model-missing' && p.problem).toMatch(/checksum/);
    });
    expect(existsSync(join(voiceDir(home), MODEL.name))).toBe(false);
    expect(existsSync(join(voiceDir(home), `${MODEL.name}.part`))).toBe(false);
  });

  it('Repair everything gets a missing model again', async () => {
    const { fetcher } = huggingFace();
    const voice = new VoiceService({
      home,
      whisper: async () => '/bin/whisper-cli',
      fetch: fetcher,
    });
    const signal = new AbortController().signal;
    expect((await voice.doctorCheck().run({ repair: false, signal }))[0]?.state).toBe('warning');
    expect((await voice.doctorCheck().run({ repair: true, signal }))[0]?.state).toBe('fixed');
    await vi.waitFor(async () => expect((await voice.status()).private.state).toBe('ready'));
  });
});

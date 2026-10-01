import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkWav, cleanTranscript, MODEL, voiceDir, VoiceService } from './service';

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

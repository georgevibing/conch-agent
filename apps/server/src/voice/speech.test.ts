import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiperProcess, SERVE, wavOf } from './piper';
import {
  groups,
  PIPER_REVISION,
  PIPER_VOICES,
  type PiperVoiceSpec,
  SpeechService,
  voicesDir,
} from './speech';

const MODEL = Buffer.from('a pretend onnx voice, a graph of numbers');
const CONFIG = Buffer.from('{"audio":{"sample_rate":22050}}');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A voice whose pinned files are the pretend ones above. */
const VOICE: PiperVoiceSpec = {
  id: 'en_US-test-medium',
  name: 'Testy',
  lang: 'en-US',
  language: 'American English',
  files: [
    {
      path: 'en/en_US/test/medium/en_US-test-medium.onnx',
      bytes: MODEL.length,
      sha256: sha(MODEL),
    },
    {
      path: 'en/en_US/test/medium/en_US-test-medium.onnx.json',
      bytes: CONFIG.length,
      sha256: sha(CONFIG),
    },
  ],
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-speech-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Hugging Face, pretending: each pinned file, or something else for `wrong`. */
function huggingFace(options: { wrong?: boolean } = {}) {
  const asked: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    asked.push(String(url));
    if (options.wrong) return new Response(new Uint8Array(Buffer.from('tampered with')));
    return new Response(new Uint8Array(String(url).endsWith('.json') ? CONFIG : MODEL));
  });
  return { fetcher: fetcher as unknown as typeof fetch, asked };
}

const placed = () => {
  mkdirSync(voicesDir(home), { recursive: true });
  writeFileSync(join(voicesDir(home), 'en_US-test-medium.onnx'), MODEL);
  writeFileSync(join(voicesDir(home), 'en_US-test-medium.onnx.json'), CONFIG);
};

/** Piper's process, pretending: a second of silence at 22 050 Hz for anything said. */
const runner = () => {
  const said: { model: string; text: string; length?: number }[] = [];
  return {
    said,
    process: () => ({
      speak: async (model: string, text: string, length?: number) => {
        said.push({ model, text, ...(length && { length }) });
        return { rate: 22_050, pcm: Buffer.alloc(44_100) };
      },
      stop: () => undefined,
    }),
  };
};

describe('natural voices', () => {
  it('pins every voice to one revision, with sizes and SHA-256s', () => {
    expect(PIPER_REVISION).toMatch(/^[0-9a-f]{40}$/);
    for (const voice of PIPER_VOICES) {
      expect(voice.files.map((f) => f.path.split('.').slice(1).join('.'))).toEqual([
        'onnx',
        'onnx.json',
      ]);
      for (const file of voice.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.path.startsWith(`${voice.lang.slice(0, 2)}/`)).toBe(true);
      }
    }
  });

  it('downloads a voice from the pinned revision, checked, and it’s ready', async () => {
    const { fetcher, asked } = huggingFace();
    const speech = new SpeechService({
      home,
      piper: async () => '/bin/piper',
      fetch: fetcher,
      voices: [VOICE],
    });
    expect((await speech.status()).voices[0]).toMatchObject({ state: 'missing' });
    await speech.getVoice('piper:en_US-test-medium');
    await speech.settled();
    expect((await speech.status()).voices[0]).toMatchObject({
      id: 'piper:en_US-test-medium',
      state: 'ready',
    });
    expect(asked[0]).toContain(`/resolve/${PIPER_REVISION}/en/en_US/test/medium/`);
  });

  it('throws away a voice that doesn’t match, and says so with a way to carry on', async () => {
    const speech = new SpeechService({
      home,
      piper: async () => '/bin/piper',
      fetch: huggingFace({ wrong: true }).fetcher,
      voices: [VOICE],
    });
    await speech.getVoice('en_US-test-medium');
    await speech.settled();
    const [voice] = (await speech.status()).voices;
    expect(voice).toMatchObject({ state: 'missing', problem: expect.stringMatching(/checksum/) });
    expect(existsSync(join(voicesDir(home), 'en_US-test-medium.onnx'))).toBe(false);
    expect(existsSync(join(voicesDir(home), 'en_US-test-medium.onnx.part'))).toBe(false);
  });

  it('refuses a voice it doesn’t know, so no path can be asked for', async () => {
    const speech = new SpeechService({ home, piper: async () => '/bin/piper', voices: [VOICE] });
    await expect(speech.getVoice('../../etc/passwd')).rejects.toThrow(/doesn’t know/);
    await expect(speech.speak('Hi', 'piper:../../evil')).rejects.toThrow(/doesn’t know/);
  });

  it('speaks with Piper kept running, at the pace asked for', async () => {
    placed();
    const piper = runner();
    const speech = new SpeechService({
      home,
      piper: async () => '/bin/piper',
      python: async () => '/tools/piper-tts/bin/python',
      process: piper.process,
      voices: [VOICE],
    });
    const wav = await speech.speak('Hello there.', 'piper:en_US-test-medium', 1.25);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(22_050);
    expect(piper.said).toEqual([
      {
        model: join(voicesDir(home), 'en_US-test-medium.onnx'),
        text: 'Hello there.',
        length: 0.8,
      },
    ]);
  });

  it('says what’s missing in words: Piper itself, or the voice', async () => {
    const without = new SpeechService({ home, piper: async () => undefined, voices: [VOICE] });
    await expect(without.speak('Hi', 'piper:en_US-test-medium')).rejects.toMatchObject({
      code: 'not-ready',
      need: 'piper',
    });
    const noVoice = new SpeechService({ home, piper: async () => '/bin/piper', voices: [VOICE] });
    await expect(noVoice.speak('Hi', 'piper:en_US-test-medium')).rejects.toThrow(
      /Testy isn’t downloaded yet/,
    );
  });

  it('answers voice notes with the voice chosen, else the first one here, never a provider nobody chose', async () => {
    placed();
    const picked: { chosen?: string; key?: string } = {};
    const speech = new SpeechService({
      home,
      piper: async () => '/bin/piper',
      chosen: async () => picked.chosen,
      openaiKey: async () => picked.key,
      voices: [VOICE],
    });
    expect(await speech.replyVoice()).toBe('piper:en_US-test-medium');
    picked.chosen = 'openai:nova';
    // No key: OpenAI's voice can't be the one.
    expect(await speech.replyVoice()).toBe('piper:en_US-test-medium');
    picked.key = 'sk-' + 'test';
    expect(await speech.replyVoice()).toBe('openai:nova');
    expect((await speech.status()).cloud.map((v) => v.id)).toContain('openai:nova');
    picked.key = undefined;
    expect((await speech.status()).cloud).toEqual([]);
  });

  it('speaks with OpenAI only with a key, and says what went wrong in words', async () => {
    const calls: { url: string; body: unknown; auth?: string }[] = [];
    let status = 200;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        auth: (init?.headers as Record<string, string>).authorization,
      });
      return new Response(new Uint8Array(wavOf(Buffer.alloc(100), 24_000)), { status });
    }) as typeof fetch;
    const speech = new SpeechService({
      home,
      piper: async () => undefined,
      openaiKey: async () => 'sk-' + 'test',
      fetch: fetcher,
    });
    const wav = await speech.speak('Hello.', 'openai:nova');
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(calls[0]).toMatchObject({
      url: 'https://api.openai.com/v1/audio/speech',
      body: { voice: 'nova', input: 'Hello.', response_format: 'wav' },
      auth: 'Bearer sk-test',
    });
    status = 401;
    await expect(speech.speak('Hello.', 'openai:nova')).rejects.toThrow(/didn’t accept your key/);
    status = 429;
    await expect(speech.speak('Hello.', 'openai:nova')).rejects.toThrow(/reached a limit/);
    await expect(speech.speak('Hello.', 'openai:not-a-voice')).rejects.toThrow(/doesn’t know/);
  });

  it('makes a voice note: the answer as it sounds, a few sentences at a time, through FFmpeg', async () => {
    placed();
    const piper = runner();
    const ran: string[][] = [];
    const speech = new SpeechService({
      home,
      piper: async () => '/bin/piper',
      ffmpeg: async () => '/bin/ffmpeg',
      python: async () => '/py',
      process: piper.process,
      voices: [VOICE],
      pipe: async (_file, args) => {
        ran.push(args);
        return { stdout: Buffer.from('OggS pretend'), stderr: '', code: 0 };
      },
    });
    const note = await speech.voiceNote(
      '**Three things** tomorrow:\n\n- stand-up at 9\n\n```js\nconsole.log(1)\n```',
      'ogg',
    );
    expect(note).toMatchObject({ mimeType: 'audio/ogg', bytes: Buffer.from('OggS pretend') });
    expect(note?.seconds).toBeGreaterThanOrEqual(1);
    // Spoken as a person reads it: no symbols, no code.
    expect(piper.said.map((s) => s.text).join(' ')).not.toMatch(/\*|console/);
    expect(ran[0]).toEqual(expect.arrayContaining(['-c:a', 'libopus']));
    // Long answers: the start, then the rest in writing.
    const long = await speech.voiceNote(`${'This is a sentence. '.repeat(200)}`, 'aac');
    expect(long?.mimeType).toBe('audio/aac');
    // What Conch made itself goes in as a WAV, through pipes only.
    expect(ran.at(-1)?.join(' ')).toContain('-protocol_whitelist pipe');
    expect(ran.at(-1)).toEqual(expect.arrayContaining(['-f', 'adts']));
    expect(piper.said.at(-1)?.text).toMatch(/The rest is in writing\.$/);
  });

  it('makes no voice note without a voice or FFmpeg', async () => {
    const speech = new SpeechService({ home, piper: async () => '/bin/piper', voices: [VOICE] });
    expect(await speech.voiceNote('Hi there.', 'ogg')).toBeUndefined();
  });

  it('Repair everything gets a damaged voice again', async () => {
    mkdirSync(voicesDir(home), { recursive: true });
    writeFileSync(join(voicesDir(home), 'en_US-test-medium.onnx'), 'half of it');
    const speech = new SpeechService({
      home,
      piper: async () => '/bin/piper',
      fetch: huggingFace().fetcher,
      voices: [VOICE],
    });
    const signal = new AbortController().signal;
    expect((await speech.doctorCheck().run({ repair: false, signal }))[0]?.state).toBe('warning');
    expect((await speech.doctorCheck().run({ repair: true, signal }))[0]?.state).toBe('fixed');
    await speech.settled();
    expect((await speech.status()).voices[0]?.state).toBe('ready');
    // Piper gone: one press to get it back.
    const noPiper = new SpeechService({ home, piper: async () => undefined, voices: [VOICE] });
    expect((await noPiper.doctorCheck().run({ repair: true, signal }))[0]).toMatchObject({
      state: 'needs-you',
      action: { kind: 'need', need: 'piper' },
    });
  });

  it('gathers sentences into pieces of about the size asked for', () => {
    expect(groups(['One.', 'Two.', 'Three.'], 9)).toEqual(['One. Two.', 'Three.']);
    expect(groups([], 10)).toEqual([]);
  });
});

/** Piper's Python, pretending: what the script prints, as the gateway would read it. */
function fakePython() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => child.emit('exit', null)),
  });
  const lines: string[] = [];
  stdin.on('data', (chunk: Buffer) => lines.push(...String(chunk).split('\n').filter(Boolean)));
  const spawn = vi.fn(() => child);
  return { child, spawn, lines, stdout };
}

describe('Piper kept running', () => {
  it('runs a fixed script with none of Conch’s environment, text on stdin only', async () => {
    const python = fakePython();
    process.env.CONCH_SECRET_TEST = 'x';
    const piper = new PiperProcess('/py', python.spawn as never);
    const spoken = piper.speak('/voices/a.onnx', 'Καλημέρα', 1.2);
    await vi.waitFor(() => expect(python.lines).toHaveLength(1));
    const [file, args, options] = python.spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(file).toBe('/py');
    expect(args).toEqual(['-u', '-c', SERVE]);
    expect(options.env.CONCH_SECRET_TEST).toBeUndefined();
    expect(options.env.PYTHONIOENCODING).toBe('utf-8');
    expect(JSON.parse(python.lines[0] ?? '')).toEqual({
      id: 1,
      model: '/voices/a.onnx',
      text: 'Καλημέρα',
      length: 1.2,
    });
    // The header, then the samples, arriving in pieces.
    const pcm = Buffer.alloc(10, 7);
    python.stdout.write(`{"id": 1, "rate": 22050, "by`);
    python.stdout.write(`tes": 10}\n`);
    python.stdout.write(pcm.subarray(0, 4));
    python.stdout.write(pcm.subarray(4));
    expect(await spoken).toEqual({ rate: 22_050, pcm });
    delete process.env.CONCH_SECRET_TEST;
    piper.stop();
  });

  it('says why when Piper can’t say something, and keeps going', async () => {
    const python = fakePython();
    const piper = new PiperProcess('/py', python.spawn as never);
    const first = piper.speak('/voices/a.onnx', 'one');
    python.stdout.write('{"id": 1, "error": "no such voice"}\n');
    await expect(first).rejects.toThrow(/no such voice/);
    const second = piper.speak('/voices/a.onnx', 'two');
    python.stdout.write('{"id": 2, "rate": 16000, "bytes": 2}\n');
    python.stdout.write(Buffer.from([1, 2]));
    expect((await second).rate).toBe(16_000);
    // One process for both.
    expect(python.spawn).toHaveBeenCalledTimes(1);
    piper.stop();
  });

  it('fails what was waiting when Piper stops, and starts again next time', async () => {
    const python = fakePython();
    const piper = new PiperProcess('/py', python.spawn as never);
    const waiting = piper.speak('/voices/a.onnx', 'one');
    python.child.emit('exit', 1);
    await expect(waiting).rejects.toThrow(/Piper stopped/);
    expect(piper.running).toBe(false);
    void piper.speak('/voices/a.onnx', 'again').catch(() => undefined);
    expect(python.spawn).toHaveBeenCalledTimes(2);
    piper.stop();
  });
});

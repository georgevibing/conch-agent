import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillSuggester } from '../skills/suggest';
import { registerLearningDoctor } from './doctor';
import { cosine, wordsVector } from './embed';
import { MemoryIndex } from './index';
import {
  loadTransformers,
  modelFor,
  ON_DEVICE_MODELS,
  OnDeviceModel,
  RunnerGone,
  runnerEnv,
  type LoadRunner,
  type OnDeviceSpec,
} from './ondevice';
import { MemoryStore } from './store';
import { MemoryTidy } from './tidy';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-meaning-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A tiny model with two files, and a pretend Hugging Face that serves them. */
const files = [
  { path: 'config.json', body: Buffer.from('{"model_type":"bert"}') },
  { path: 'onnx/model_quantized.onnx', body: Buffer.alloc(200_000, 'weights ') },
];
const spec = (over: Partial<OnDeviceSpec> = {}): OnDeviceSpec => ({
  id: 'tiny',
  name: 'tiny-MiniLM',
  repo: 'test/tiny',
  revision: 'abcdef0123456789',
  multilingual: false,
  floor: 0.3,
  same: 0.55,
  files: files.map((f) => ({
    path: f.path,
    bytes: f.body.length,
    sha256: createHash('sha256').update(f.body).digest('hex'),
  })),
  ...over,
});

function hub(options: { fail?: number; body?: (path: string) => Buffer } = {}) {
  let failures = options.fail ?? 0;
  const urls: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (failures > 0) {
      failures--;
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    }
    const file = files.find((f) => url.endsWith(`/${f.path}`));
    if (!file) return new Response('nope', { status: 404 });
    const body = options.body?.(file.path) ?? file.body;
    const pieces = [body.subarray(0, body.length >> 1), body.subarray(body.length >> 1)];
    return new Response(
      new ReadableStream({
        pull(controller) {
          const next = pieces.shift();
          if (next) controller.enqueue(next);
          else controller.close();
        },
      }),
    );
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, urls };
}

/** A runner that knows anniversaries are about weddings. */
const load: LoadRunner = async () => ({
  async embed(texts) {
    return texts.map((t) => {
      const v = new Float32Array(3);
      if (/anniversar|married|wedding/i.test(t)) v[0] = 1;
      else if (/\bcar\b|vehicle/i.test(t)) v[1] = 1;
      else v[2] = 1;
      return v;
    });
  },
  dispose: async () => undefined,
});

const model = (over: Partial<ConstructorParameters<typeof OnDeviceModel>[0]> = {}) =>
  new OnDeviceModel({
    dir: join(home, 'models'),
    specs: [spec()],
    load,
    sleep: async () => undefined,
    ...over,
  });

describe('choosing the model', () => {
  it('English when everyone speaks English, the multilingual one otherwise', () => {
    expect(modelFor(['en-GB', 'en']).multilingual).toBe(false);
    expect(modelFor(['en-US', 'de-DE']).multilingual).toBe(true);
    expect(modelFor(['pt-BR']).name).toBe('paraphrase-multilingual-MiniLM-L12-v2');
  });

  it('pins every file by revision, size and SHA-256', () => {
    for (const s of ON_DEVICE_MODELS) {
      expect(s.revision).toMatch(/^[0-9a-f]{40}$/);
      for (const f of s.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.bytes).toBeGreaterThan(0);
      }
    }
  });
});

describe('getting the model', () => {
  it('downloads once, with progress, from the pinned revision; then it means something', async () => {
    const { fetch, urls } = hub();
    const m = model({ fetch });
    expect(await m.offer(['en-GB'])).toEqual({
      model: 'tiny-MiniLM',
      bytes: files.reduce((n, f) => n + f.body.length, 0),
      multilingual: false,
    });
    expect(await m.embedder()).toBeUndefined();
    const seen: number[] = [];
    let usable: unknown;
    const getting = m.get(['en-GB'], () => void m.embedder().then((e) => (usable = e)));
    // Started before anything is awaited: the next look already sees it.
    expect(m.status().getting).toBe(0);
    const poll = setInterval(() => seen.push(m.status().getting ?? -1), 0);
    await getting;
    clearInterval(poll);
    expect(urls).toEqual([
      'https://huggingface.co/test/tiny/resolve/abcdef0123456789/config.json',
      'https://huggingface.co/test/tiny/resolve/abcdef0123456789/onnx/model_quantized.onnx',
    ]);
    expect(m.status()).toMatchObject({ ready: { id: 'tiny' } });
    // Whoever's told it's here can use it straight away.
    await vi.waitFor(() => expect(usable).toBeDefined());
    expect(m.status().getting).toBeUndefined();
    expect(await m.offer(['en-GB'])).toBeUndefined();
    expect(existsSync(join(home, 'models', 'test/tiny/onnx/model_quantized.onnx'))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'models', 'meaning.json'), 'utf8')).model).toBe(
      'tiny',
    );

    const embedder = await m.embedder();
    expect(embedder).toMatchObject({ source: 'built-in', label: 'tiny-MiniLM', floor: 0.3 });
    expect(embedder?.id).toBe('built-in:tiny@abcdef0');
    const [a, b] = (await embedder?.embed(['our anniversary', 'wedding photos'])) ?? [];
    expect(a && b && cosine(a, b)).toBe(1);

    // A second Conch on the same folder: already here, nothing fetched.
    const again = hub();
    expect(await model({ fetch: again.fetch }).embedder()).toBeDefined();
    expect(again.urls).toEqual([]);
  });

  it('rides out a flaky network by itself', async () => {
    const { fetch } = hub({ fail: 2 });
    const sleep = vi.fn(async () => undefined);
    const m = model({ fetch, sleep });
    await m.get([]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(m.status().ready).toBeDefined();
  });

  it('says so, in plain words, when the internet stays away; Get it again works', async () => {
    const m = model({ fetch: hub({ fail: 99 }).fetch });
    await expect(m.get([])).rejects.toThrow(/internet seems to be unreachable/);
    expect(m.status().problem).toMatch(/internet seems to be unreachable/);
    expect(await m.embedder()).toBeUndefined();
    const fixed = model({ fetch: hub().fetch });
    await fixed.get([]);
    expect(fixed.status().problem).toBeUndefined();
  });

  it('throws away anything that isn’t exactly the pinned file', async () => {
    const { fetch } = hub({
      body: (path) =>
        path === 'config.json'
          ? Buffer.from('{"model_type":"evil"}')
          : (files.find((f) => f.path === path)?.body ?? Buffer.alloc(0)),
    });
    const m = model({ fetch });
    await expect(m.get([])).rejects.toThrow(/wasn’t the model Conch expected/);
    expect(existsSync(join(home, 'models', 'test/tiny/config.json'))).toBe(false);
    expect(existsSync(join(home, 'models', 'test/tiny/config.json.part'))).toBe(false);
    expect(await m.embedder()).toBeUndefined();
  });

  it('carries on a download cut short by a restart, and clears half-written files', async () => {
    const first = hub({ fail: 99 });
    await model({ fetch: first.fetch })
      .get([])
      .catch(() => undefined);
    const part = join(home, 'models', 'test/tiny/onnx/model_quantized.onnx.part');
    mkdirSync(join(part, '..'), { recursive: true });
    writeFileSync(part, 'half');
    const heal = vi.fn();
    const ready = vi.fn();
    const m = model({ fetch: hub().fetch, heal });
    await m.resume(ready);
    expect(existsSync(part)).toBe(false);
    expect(m.status().ready).toBeDefined();
    expect(ready).toHaveBeenCalled();
    expect(heal).toHaveBeenCalledWith(expect.stringMatching(/so Conch got it again/));
  });

  it('never downloads unasked', async () => {
    const { fetch, urls } = hub();
    const m = model({ fetch });
    await m.resume();
    expect(await m.embedder()).toBeUndefined();
    expect(urls).toEqual([]);
  });

  it('falls back to words when the model won’t run on this computer, and says why', async () => {
    const memories = new MemoryStore(join(home, 'memory'));
    await memories.add({ content: 'Got married on 12 June 2019', source: 'user' });
    const m = model({
      fetch: hub().fetch,
      load: () => Promise.reject(new Error('dlopen failed')),
    });
    await m.get([]);
    const index = new MemoryIndex({
      path: join(home, 'idx.db'),
      store: memories,
      meaning: () => m.embedder(),
      offer: (l) => m.offer(l),
    });
    // The concept layer still finds it with words alone.
    expect((await index.search('our anniversary'))[0]?.memory.content).toMatch(/married/);
    expect(m.status().problem).toMatch(/couldn’t run the model/);
    expect((await index.status()).mode).toBe('words');
    index.close();
  });

  it('starts the model again when its process stops, and sets it aside if it keeps stopping', async () => {
    let loads = 0;
    const m = model({
      fetch: hub().fetch,
      load: async () => {
        loads++;
        return {
          embed: () => Promise.reject(new RunnerGone('The model’s process stopped (SIGSEGV).')),
          dispose: async () => undefined,
        };
      },
    });
    await m.get([]);
    const embedder = await m.embedder();
    await expect(embedder?.embed(['hello'])).rejects.toThrow(/process stopped/);
    expect(m.status().problem).toBeUndefined();
    await expect(embedder?.embed(['hello'])).rejects.toThrow(/process stopped/);
    expect(loads).toBe(2);
    expect(m.status().problem).toMatch(/couldn’t run the model/);
    expect(await m.embedder()).toBeUndefined();
    // Repair tries once more.
    m.retryRun();
    expect(await m.embedder()).toBeDefined();
  });
});

describe('Repair everything', () => {
  const doctor = async (m: OnDeviceModel, repair: boolean) => {
    const store = new MemoryStore(join(home, 'memory'));
    const index = new MemoryIndex({
      path: join(home, 'idx.db'),
      store,
      meaning: () => m.embedder(),
    });
    const tidy = new MemoryTidy({
      home,
      store,
      model: async () => undefined,
      said: async () => [],
      settings: async () => ({ autoMemory: true, tidyMemory: false }),
      busy: () => false,
    });
    let check: { run(ctx: { repair: boolean }): Promise<unknown> } | undefined;
    registerLearningDoctor(
      { register: (c) => void (check = c as never) },
      { index, store, tidy, model: m, reindex: () => index.sync() },
    );
    const items = (await check?.run({ repair })) as {
      id: string;
      state: string;
      message: string;
    }[];
    index.close();
    return items.find((i) => i.id === 'memory:model');
  };

  it('notices a damaged model and gets it again (the person already said yes)', async () => {
    const m = model({ fetch: hub().fetch });
    await m.get([]);
    expect(await doctor(m, false)).toBeUndefined();
    writeFileSync(join(home, 'models', 'test/tiny/onnx/model_quantized.onnx'), 'corrupt');
    expect(await doctor(m, false)).toMatchObject({
      state: 'warning',
      message: expect.stringMatching(/missing or damaged/),
    });
    expect(await doctor(m, true)).toMatchObject({ state: 'fixed' });
    expect(await m.check({ fresh: true })).toBe('ok');
  });

  it('says nothing about a model nobody asked for', async () => {
    expect(await doctor(model(), true)).toBeUndefined();
  });
});

/**
 * The real model, when it's on this computer already (`CONCH_HOME/models`,
 * else `~/.conch/models`): skipped otherwise, so tests never download.
 */
const cacheDir = join(process.env.CONCH_HOME ?? join(homedir(), '.conch'), 'models');
const [english, many] = ON_DEVICE_MODELS as [OnDeviceSpec, OnDeviceSpec];
const cached = (s: OnDeviceSpec) =>
  s.files.every((f) => existsSync(join(cacheDir, s.repo, f.path)));

describe.skipIf(!cached(english))('the real model (all-MiniLM-L6-v2)', () => {
  /** The real thing: the model in its own process, as Conch runs it. */
  const real = () => new OnDeviceModel({ dir: join(home, 'models'), specs: [english] });
  const copy = (s: OnDeviceSpec) => {
    for (const f of s.files) {
      const to = join(home, 'models', s.repo, f.path);
      mkdirSync(join(to, '..'), { recursive: true });
      writeFileSync(to, readFileSync(join(cacheDir, s.repo, f.path)));
    }
    writeFileSync(join(home, 'models', 'meaning.json'), JSON.stringify({ model: s.id, at: 0 }));
  };

  it('finds what you meant: anniversary → wedding, car → vehicle', async () => {
    copy(english);
    const m = real();
    const memories = new MemoryStore(join(home, 'memory'));
    for (const content of [
      'Our wedding was on 12 June 2019 in Porto',
      'Drives a small electric vehicle to work',
      'Prefers dark roast coffee',
      'Lives in Lisbon',
      'Allergic to peanuts',
    ])
      await memories.add({ content, source: 'user' });
    const index = new MemoryIndex({
      path: join(home, 'idx.db'),
      store: memories,
      meaning: () => m.embedder(),
    });
    expect((await index.status()).model).toBe('all-MiniLM-L6-v2');
    expect((await index.search('when is our anniversary?'))[0]?.memory.content).toMatch(/wedding/);
    // Beyond the concept layer: only the model knows these.
    expect((await index.search('hot beverage I like'))[0]?.memory.content).toMatch(/coffee/);
    expect((await index.search('which city is home'))[0]?.memory.content).toBe('Lives in Lisbon');
    expect((await index.status()).indexed).toBe(5);
    expect((await index.search('which automobile do I have'))[0]?.memory.content).toMatch(
      /vehicle/,
    );
    expect((await index.search('nut allergy'))[0]?.memory.content).toMatch(/peanuts/);
    // Unrelated stays out.
    expect((await index.search('my favourite football team')).map((r) => r.memory.content)).toEqual(
      [],
    );
    index.close();
    await m.unload();
  }, 60_000);

  it('makes one suggestion from three differently worded requests, none from unrelated ones', async () => {
    copy(english);
    const m = real();
    const at = Date.now();
    const ask = (text: string, conversationId: string) => ({ text, conversationId, at });
    const suggester = new SkillSuggester({
      home,
      asked: async () => [
        ask('Write my weekly summary of calendar meetings', 'a'),
        ask('Give me a recap of this week’s meetings', 'b'),
        ask('What happened in my meetings this week? Sum it up', 'c'),
        ask('What is the weather in Lisbon tomorrow', 'd'),
        ask('Book a table for dinner on Saturday', 'e'),
        ask('Write a weekly newsletter for my customers', 'f'),
      ],
      skills: async () => [],
      model: async () => undefined,
      meaning: () => m.embedder(),
    });
    const found = await suggester.list();
    expect(found).toHaveLength(1);
    expect(found[0]?.times).toBe(3);
    expect(found[0]?.examples.map((e) => e.conversationId).sort()).toEqual(['a', 'b', 'c']);

    // Already a skill, by meaning: nothing to offer.
    const have = new SkillSuggester({
      home,
      asked: async () => [
        ask('Write my weekly summary of calendar meetings', 'a'),
        ask('Give me a recap of this week’s meetings', 'b'),
        ask('What happened in my meetings this week? Sum it up', 'c'),
      ],
      skills: async () => [
        { title: 'Week in review', description: 'Summarises the meetings you had this week.' },
      ],
      model: async () => undefined,
      meaning: () => m.embedder(),
    });
    expect(await have.list()).toEqual([]);
    await m.unload();
  }, 60_000);

  it('indexes 1,000 memories in a few seconds', async () => {
    copy(english);
    const m = real();
    const memories = new MemoryStore(join(home, 'memory'));
    const topics = ['hiking', 'coffee', 'piano', 'Lisbon', 'the kids', 'tax returns', 'tennis'];
    for (let i = 0; i < 1000; i++)
      await memories.add({
        content: `Note ${i}: talked about ${topics[i % topics.length]} with friend number ${i % 41}`,
        source: 'user',
      });
    const index = new MemoryIndex({
      path: join(home, 'idx.db'),
      store: memories,
      meaning: () => m.embedder(),
    });
    await (await m.embedder())?.embed(['warm up']);
    const started = performance.now();
    await index.sync();
    const ms = performance.now() - started;
    const status = await index.status();
    expect(status).toMatchObject({ mode: 'meaning', indexed: 1000, total: 1000 });
    console.warn(`[meaning] indexed 1,000 memories with all-MiniLM-L6-v2 in ${Math.round(ms)} ms`);
    // Generous: other work shares this computer.
    expect(ms).toBeLessThan(60_000);
    index.close();
    await m.unload();
  }, 120_000);
});

describe.skipIf(!cached(many))('the real multilingual model', () => {
  it('matches across languages: Hochzeitstag → wedding, café → coffee', async () => {
    const r = await loadTransformers(cacheDir, many);
    const [hochzeit, wedding, cafe, coffee, lisbon] = await r.embed([
      'Wann ist unser Hochzeitstag?',
      'Our wedding was on 12 June 2019',
      'Je préfère le café noir',
      'Prefers dark roast coffee',
      'Lives in Lisbon',
    ]);
    const near = (a?: Float32Array, b?: Float32Array) => (a && b ? cosine(a, b) : 0);
    expect(near(hochzeit, wedding)).toBeGreaterThan(many.floor);
    expect(near(hochzeit, wedding)).toBeGreaterThan(near(hochzeit, lisbon) + 0.2);
    expect(near(cafe, coffee)).toBeGreaterThan(near(cafe, lisbon) + 0.2);
    await r.dispose();
  }, 60_000);
});

describe('the model’s own process', () => {
  it('sees none of Conch’s environment: no keys, no settings', () => {
    process.env.CONCH_TEST_SECRET = 'pretend-secret-value';
    try {
      const env = runnerEnv();
      expect(
        Object.keys(env).every((k) =>
          /^(PATH|Path|SYSTEMROOT|SystemRoot|TEMP|TMP|TMPDIR|LANG|HOME)$/.test(k),
        ),
      ).toBe(true);
      expect(JSON.stringify(env)).not.toContain('pretend-secret-value');
    } finally {
      delete process.env.CONCH_TEST_SECRET;
    }
  });
});

describe('the built-in vectors', () => {
  it('know a few concepts before any download', () => {
    expect(cosine(wordsVector('my car'), wordsVector('vehicle'))).toBeGreaterThan(0.3);
  });
});

import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalStatus } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../engines/api/fake';
import type { FetchLike } from '../engines/api/types';
import { Setup, type NeedSpec, type Platform } from '../setup/needs';
import { LocalError, LocalService, type LocalDeps } from './service';

const GiB = 1024 ** 3;

const QWEN_TAG = {
  name: 'qwen3:4b-instruct',
  model: 'qwen3:4b-instruct',
  size: 2_497_293_803,
  digest: 'abc',
  details: { family: 'qwen3', parameter_size: '4.0B', quantization_level: 'Q4_K_M' },
};
const EMBED_TAG = { name: 'nomic-embed-text:latest', size: 274_000_000, digest: 'def' };

interface World {
  running: boolean;
  tags: unknown[];
  version: string;
  pull?: (signal: AbortSignal | undefined) => Response;
  /** What `/api/show` says of the model's shape, beyond its context length. */
  info?: Record<string, unknown>;
}

/** A pretend Ollama, answering on loopback only. */
function ollama(world: World): { fetch: FetchLike; calls: { url: string; body?: unknown }[] } {
  const calls: { url: string; body?: unknown }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, body });
    if (!world.running) throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:11434');
    const path = new URL(url).pathname;
    if (path === '/api/version') return jsonResponse({ version: world.version });
    if (path === '/api/tags') return jsonResponse({ models: world.tags });
    if (path === '/api/ps') return jsonResponse({ models: [] });
    if (path === '/api/show') {
      const name = (body as { model: string }).model;
      return jsonResponse(
        name.startsWith('nomic')
          ? { capabilities: ['embedding'] }
          : {
              capabilities: ['completion', 'tools'],
              model_info: { 'qwen3.context_length': 262_144, ...world.info },
            },
      );
    }
    if (path === '/api/pull' && world.pull) return world.pull(init?.signal ?? undefined);
    return jsonResponse({ error: 'not found' }, 404);
  };
  return { fetch, calls };
}

/** NDJSON pull progress, all at once. */
function pullLines(...lines: unknown[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });
}

function fakeSpawn(onStart: (command: string, args: string[]) => void) {
  return vi.fn((command: string, args: string[]) => {
    onStart(command, args);
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => undefined;
    void command;
    void args;
    return child;
  });
}

async function service(
  options: {
    world?: Partial<World>;
    installed?: boolean;
    platform?: Platform;
    program?: string;
    models?: boolean;
    memory?: number;
    freeDisk?: number;
    env?: NodeJS.ProcessEnv;
    startsOk?: boolean;
    /** Only `ollama serve` brings the server up (the app is stuck without one). */
    appStuck?: boolean;
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-local-'));
  const modelsDir = join(home, 'ollama-models');
  if (options.models)
    await mkdir(join(modelsDir, 'manifests', 'registry.ollama.ai'), { recursive: true });
  const world: World = { running: false, tags: [], version: '0.35.0', ...options.world };
  const { fetch, calls } = ollama(world);
  const spec: NeedSpec = {
    id: 'ollama',
    name: 'Ollama',
    short: 'Ollama',
    find: async () =>
      options.installed === false
        ? undefined
        : (options.program ?? join(home, 'bin', 'ollama.exe')),
  };
  const heal = vi.fn();
  const onChange = vi.fn();
  const spawn = fakeSpawn((_command, args) => {
    if (options.appStuck && args[0] !== 'serve') return;
    if (options.startsOk !== false) world.running = true;
  });
  const deps: LocalDeps = {
    home,
    setup: new Setup(new Map([['ollama', spec]]), { platform: options.platform ?? 'win32' }),
    env: { OLLAMA_MODELS: modelsDir, ...options.env },
    fetch,
    spawn: spawn as unknown as LocalDeps['spawn'],
    memory: () => options.memory ?? 15.4 * GiB,
    freeDisk: async () => options.freeDisk ?? 100e9,
    heal,
    onChange,
    startTimeoutMs: 1_000,
  };
  return { local: new LocalService(deps), world, calls, spawn, heal, onChange, home, modelsDir };
}

describe('finding Ollama', () => {
  it('offers to install it when it isn’t here, and says nothing is wrong', async () => {
    const { local } = await service({ installed: false });
    const status = LocalStatus.parse(await local.status());
    expect(status.ollama.state).toBe('missing');
    expect(status.offers.find((o) => o.recommended)?.name).toBe('qwen3.5:9b');
    expect(await local.engineStatus()).toMatchObject({
      state: 'not-installed',
      fix: { need: 'ollama', kind: 'install' },
    });
    const [item] = await local
      .doctorCheck()
      .run({ repair: false, signal: new AbortController().signal });
    expect(item).toMatchObject({ id: 'local-model:ollama', state: 'off' });
  });

  it('leaves an Ollama nobody uses here alone', async () => {
    const { local, spawn } = await service();
    expect(await local.engineStatus()).toMatchObject({
      state: 'not-installed',
      message: 'Get a model to start chatting. It’s free, and it runs on this computer.',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts a stopped Ollama that has models, quietly, and says so', async () => {
    const { local, spawn, heal, onChange } = await service({
      models: true,
      world: { tags: [QWEN_TAG] },
    });
    const status = await local.engineStatus();
    expect(status).toMatchObject({
      state: 'ready',
      version: 'Ollama 0.35.0',
      auth: { description: 'Qwen3 4B · works offline' },
    });
    // No `ollama app.exe` next to it here, so `ollama serve`, detached and hidden.
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/ollama\.exe$/),
      ['serve'],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true }),
    );
    expect(heal).toHaveBeenCalledWith('Ollama wasn’t running, so Conch started it.');
    expect(onChange).toHaveBeenCalled();
    // For this computer only, whatever the environment says.
    const [, , options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(options.env.OLLAMA_HOST).toBe('127.0.0.1:11434');
  });

  it('never starts an Ollama that answers the network, even when OLLAMA_HOST says every address', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-ollama-app-'));
    await writeFile(join(dir, 'ollama app.exe'), '');
    const { local, spawn, calls } = await service({
      program: join(dir, 'ollama.exe'),
      env: { OLLAMA_HOST: '0.0.0.0:11500' },
    });
    expect(await local.ensureRunning({ note: false })).toBe(true);
    // Not the app (it keeps its own settings): the server itself, on loopback.
    expect(spawn.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [join(dir, 'ollama.exe'), ['serve']],
    ]);
    const [, , options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(options.env.OLLAMA_HOST).toBe('127.0.0.1:11500');
    expect(calls.every((c) => c.url.startsWith('http://127.0.0.1:11500/'))).toBe(true);
  });

  it('warns in Repair everything when OLLAMA_HOST opens Ollama to the network', async () => {
    const { local } = await service({
      env: { OLLAMA_HOST: '0.0.0.0' },
      world: { running: true, tags: [QWEN_TAG] },
    });
    const items = await local
      .doctorCheck()
      .run({ repair: false, signal: new AbortController().signal });
    expect(items[0]).toMatchObject({ id: 'local-model:ollama', state: 'ok' });
    expect(items[1]).toMatchObject({
      id: 'local-model:network',
      state: 'warning',
      message: expect.stringMatching(
        /Other computers on your network can reach Ollama.*127\.0\.0\.1/,
      ),
      action: { kind: 'command', command: 'setx OLLAMA_HOST 127.0.0.1' },
    });
    // The Mac says it its own way; nothing to warn about when it's this computer only.
    const mac = await service({
      platform: 'darwin',
      env: { OLLAMA_HOST: '[::]:11434' },
      world: { running: true, tags: [QWEN_TAG] },
    });
    const [, macItem] = await mac.local
      .doctorCheck()
      .run({ repair: false, signal: new AbortController().signal });
    expect(macItem?.action).toMatchObject({ command: 'launchctl setenv OLLAMA_HOST 127.0.0.1' });
    const safe = await service({
      env: { OLLAMA_HOST: '127.0.0.1' },
      world: { running: true, tags: [QWEN_TAG] },
    });
    expect(
      await safe.local.doctorCheck().run({ repair: false, signal: new AbortController().signal }),
    ).toHaveLength(1);
    // Not installed: nothing listens, so nothing to warn about.
    const missing = await service({ installed: false, env: { OLLAMA_HOST: '0.0.0.0' } });
    expect(
      await missing.local
        .doctorCheck()
        .run({ repair: false, signal: new AbortController().signal }),
    ).toHaveLength(1);
  });

  it('starts the Windows app hidden in the tray when it’s there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-ollama-app-'));
    await writeFile(join(dir, 'ollama app.exe'), '');
    const { local, spawn } = await service({ program: join(dir, 'ollama.exe') });
    expect(await local.ensureRunning({ note: false })).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      join(dir, 'ollama app.exe'),
      ['--hide', '--fast-startup'],
      expect.anything(),
    );
  });

  it('falls back to `ollama serve` when the app is there but its server isn’t', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-ollama-app-'));
    await writeFile(join(dir, 'ollama app.exe'), '');
    const { local, spawn, heal } = await service({
      program: join(dir, 'ollama.exe'),
      appStuck: true,
    });
    expect(await local.ensureRunning({ note: true })).toBe(true);
    expect(spawn.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [join(dir, 'ollama app.exe'), ['--hide', '--fast-startup']],
      [join(dir, 'ollama.exe'), ['serve']],
    ]);
    expect(heal).toHaveBeenCalledWith('Ollama wasn’t running, so Conch started it.');
  });

  it('never starts Ollama while its installer is still running', async () => {
    const { local, spawn } = await service({ models: true });
    vi.spyOn(Setup.prototype, 'readiness').mockResolvedValue({
      ready: false,
      needs: [
        { id: 'ollama', name: 'Ollama', short: 'Ollama', openable: false, state: 'installing' },
      ],
    });
    expect(await local.ensureRunning({ note: true })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('opens the Mac app hidden', async () => {
    const { local, spawn } = await service({
      platform: 'darwin',
      program: '/Applications/Ollama.app/Contents/Resources/ollama',
    });
    await local.ensureRunning({ note: false });
    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['-j', '-a', '/Applications/Ollama.app'],
      expect.anything(),
    );
  });

  it('starts it once when two turns find it stopped', async () => {
    const { local, spawn } = await service();
    const [a, b] = await Promise.all([
      local.ensureRunning({ note: true }),
      local.ensureRunning({ note: true }),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('says so when Ollama won’t start', async () => {
    const { local, heal } = await service({ models: true, startsOk: false });
    expect(await local.engineStatus()).toMatchObject({
      state: 'error',
      message: 'Ollama is installed but didn’t start. Open Ollama once, or press Repair.',
    });
    expect(heal).not.toHaveBeenCalled();
  });

  it('won’t follow OLLAMA_HOST to another computer', async () => {
    const { local, calls, spawn } = await service({
      env: { OLLAMA_HOST: '192.168.1.20:11434' },
      world: { running: true, tags: [QWEN_TAG] },
    });
    const status = await local.status();
    expect(status.ollama.state).toBe('elsewhere');
    expect(status.ollama.message).toMatch(/isn’t this computer/);
    expect(await local.engineStatus()).toMatchObject({ state: 'error' });
    expect(calls.filter((c) => !c.url.startsWith('http://127.0.0.1:11434'))).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('lists models that can chat, never embeddings, and never asks the internet', async () => {
    const { local, calls } = await service({
      world: { running: true, tags: [QWEN_TAG, EMBED_TAG] },
    });
    const models = await local.models();
    expect(models).toEqual([
      {
        name: 'qwen3:4b-instruct',
        label: 'Qwen3 4B',
        sizeBytes: 2_497_293_803,
        tools: true,
        vision: false,
        thinking: false,
        parameters: '4.0B',
      },
    ]);
    expect(calls.every((c) => c.url.startsWith('http://127.0.0.1:11434/'))).toBe(true);
    // 32K on a 16 GB computer, well inside what the model can read.
    expect(local.contextFor('qwen3:4b-instruct')).toBe(32_768);
  });

  it('never lists a cloud model as one on this computer', async () => {
    // What `/api/tags` says once someone has signed in to ollama.com and pulled cloud models.
    const cloud = [
      {
        name: 'gpt-oss:120b-cloud',
        model: 'gpt-oss:120b-cloud',
        remote_model: 'gpt-oss:120b',
        remote_host: 'https://ollama.com:443',
        size: 384,
        digest: 'c1',
        details: { family: 'gptoss', parameter_size: '116.8B' },
      },
      // An Ollama that doesn't say where it goes: the name still tells.
      { name: 'qwen3-coder:480b-cloud', size: 382, digest: 'c2' },
      { name: 'glm-4.6:cloud', size: 380, digest: 'c3' },
      // Only the host set, with an ordinary-looking name.
      { name: 'kimi-k2:latest', remote_host: 'https://ollama.com:443', size: 390, digest: 'c4' },
    ];
    const { local, calls } = await service({
      world: { running: true, tags: [...cloud, QWEN_TAG] },
    });
    expect((await local.models()).map((m) => m.name)).toEqual(['qwen3:4b-instruct']);
    // Not even asked about: nothing about them is shown.
    const shown = calls
      .filter((c) => c.url.endsWith('/api/show'))
      .map((c) => (c.body as { model: string }).model);
    expect(shown).toEqual(['qwen3:4b-instruct']);
    await expect(local.choose('gpt-oss:120b-cloud')).rejects.toThrow(/isn’t on this computer/);
  });

  it('asks for less context on a small computer, and never more than the model reads', async () => {
    const { local } = await service({
      memory: 7.6 * GiB,
      world: { running: true, tags: [QWEN_TAG] },
    });
    await local.models();
    expect(local.contextFor('qwen3:4b-instruct')).toBe(16_384);
  });

  it('asks for more context where the model’s shape says the computer has room (ADR 0082)', async () => {
    // Qwen3 4B as Ollama describes it: 36 layers, 8 key-value heads of 128 — 144 KB a token.
    const info = {
      'general.architecture': 'qwen3',
      'qwen3.block_count': 36,
      'qwen3.attention.head_count': 32,
      'qwen3.attention.head_count_kv': 8,
      'qwen3.attention.key_length': 128,
      'qwen3.attention.value_length': 128,
      'qwen3.embedding_length': 2560,
    };
    const roomy = await service({
      memory: 32 * GiB,
      world: { running: true, tags: [QWEN_TAG], info },
    });
    await roomy.local.models();
    expect(roomy.local.contextFor('qwen3:4b-instruct')).toBe(65_536);
    // 16 GB: the cache for more than 32K wouldn't leave room, so it stays as it was.
    const usual = await service({
      memory: 16 * GiB,
      world: { running: true, tags: [QWEN_TAG], info },
    });
    await usual.local.models();
    expect(usual.local.contextFor('qwen3:4b-instruct')).toBe(32_768);
  });
});

describe('getting a model', () => {
  it('downloads with progress, then makes it the one local chats use', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const encoder = new TextEncoder();
    const lines = [
      { status: 'pulling manifest' },
      {
        status: 'pulling aaa',
        digest: 'sha256:aaa',
        total: 2_497_000_000,
        completed: 1_000_000_000,
      },
      {
        status: 'pulling aaa',
        digest: 'sha256:aaa',
        total: 2_497_000_000,
        completed: 2_497_000_000,
      },
      { status: 'verifying sha256 digest' },
      { status: 'writing manifest' },
      { status: 'success' },
    ];
    const send = (controller: ReadableStreamDefaultController, line: unknown) =>
      controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    // The first two lines, then a wait, then the rest.
    const svc = await service({
      world: {
        running: true,
        pull: () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                send(controller, lines[0]);
                send(controller, lines[1]);
                await gate;
                for (const line of lines.slice(2)) send(controller, line);
                controller.close();
              },
            }),
          ),
      },
    });
    const started = await svc.local.pull('qwen3:4b-instruct');
    expect(started.pull).toMatchObject({
      model: 'qwen3:4b-instruct',
      label: 'Qwen3 4B',
      state: 'pulling',
    });
    await vi.waitFor(async () =>
      expect((await svc.local.status()).pull).toMatchObject({
        phase: 'Downloading',
        completedBytes: 1_000_000_000,
        totalBytes: 2_497_000_000,
      }),
    );
    svc.world.tags = [QWEN_TAG];
    release();
    await svc.local.settled();
    const after = await svc.local.status();
    expect(after.pull).toMatchObject({ state: 'done', phase: 'Done' });
    expect(after.chosen).toBe('qwen3:4b-instruct');
    expect(after.offers.find((o) => o.name === 'qwen3:4b-instruct')?.installed).toBe(true);
    expect(JSON.parse(await readFile(join(svc.home, 'local.json'), 'utf8'))).toMatchObject({
      model: 'qwen3:4b-instruct',
    });
    expect(svc.onChange).toHaveBeenCalled();
  });

  it('pauses, keeping what it has, and carries on from there', async () => {
    const encoder = new TextEncoder();
    let attempt = 0;
    const svc = await service({
      world: {
        running: true,
        pull: (signal) => {
          attempt += 1;
          const first = attempt === 1;
          return new Response(
            new ReadableStream({
              start(controller) {
                const line = (o: unknown) =>
                  controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
                line({
                  status: 'pulling aaa',
                  digest: 'sha256:aaa',
                  total: 1_000,
                  completed: first ? 400 : 400,
                });
                if (first) {
                  // Stays open until the person pauses.
                  signal?.addEventListener('abort', () =>
                    controller.error(new DOMException('aborted', 'AbortError')),
                  );
                  return;
                }
                line({
                  status: 'pulling aaa',
                  digest: 'sha256:aaa',
                  total: 1_000,
                  completed: 1_000,
                });
                line({ status: 'success' });
                controller.close();
              },
            }),
          );
        },
      },
    });
    await svc.local.pull('llama3.2:3b');
    await vi.waitFor(async () => expect((await svc.local.status()).pull?.completedBytes).toBe(400));
    const paused = svc.local.pause();
    expect(paused).toMatchObject({ state: 'paused', phase: 'Paused', completedBytes: 400 });
    await svc.local.settled();
    expect((await svc.local.status()).pull?.state).toBe('paused');

    await svc.local.pull('llama3.2:3b');
    await svc.local.settled();
    expect((await svc.local.status()).pull).toMatchObject({ state: 'done', completedBytes: 1_000 });
    expect(attempt).toBe(2);
  });

  it('cancels, and forgets it', async () => {
    const svc = await service({
      world: {
        running: true,
        pull: (signal) =>
          new Response(
            new ReadableStream({
              start(controller) {
                signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
              },
            }),
          ),
      },
    });
    await svc.local.pull('llama3.2:3b');
    svc.local.cancel();
    await svc.local.settled();
    expect((await svc.local.status()).pull).toBeUndefined();
  });

  it('says why when a download fails', async () => {
    const svc = await service({
      world: {
        running: true,
        pull: () =>
          pullLines(
            { status: 'pulling manifest' },
            { error: 'pull model manifest: file does not exist' },
          ),
      },
    });
    await svc.local.pull('llama3.2:3b');
    await svc.local.settled();
    expect((await svc.local.status()).pull).toMatchObject({
      state: 'failed',
      message: 'Llama 3.2 isn’t available to download right now.',
    });
  });

  it('starts Ollama first when it has to', async () => {
    const svc = await service({ world: { pull: () => pullLines({ status: 'success' }) } });
    await svc.local.pull('llama3.2:3b');
    expect(svc.spawn).toHaveBeenCalled();
    // A person pressed Download: no "fixed on its own" note for that.
    expect(svc.heal).not.toHaveBeenCalled();
  });

  it('only downloads models Conch suggests', async () => {
    const { local } = await service({ world: { running: true } });
    await expect(local.pull('evil/model:latest')).rejects.toThrow(LocalError);
    await expect(local.pull('llama3.2:1b')).rejects.toThrow(
      /only downloads the models it suggests/,
    );
  });

  it('never downloads a model that won’t fit', async () => {
    const small = await service({ memory: 7.6 * GiB, world: { running: true } });
    await expect(small.local.pull('qwen3.6:35b-a3b')).rejects.toThrow(/needs more memory/);
    const full = await service({ freeDisk: 1e9, world: { running: true } });
    await expect(full.local.pull('llama3.2:3b')).rejects.toThrow(
      'Llama 3.2 needs 4.0 GB of free space, and this computer has 1.0 GB. Free up about 3.0 GB, then try again.',
    );
  });

  it('asks for a newer Ollama when a model needs one', async () => {
    const { local } = await service({ world: { running: true, version: '0.12.3' } });
    await expect(local.pull('qwen3.5:9b')).rejects.toThrow(
      /needs a newer Ollama \(0\.17\.1 or later\)/,
    );
  });

  it('says to install Ollama first when it isn’t here', async () => {
    const { local } = await service({ installed: false });
    await expect(local.pull('llama3.2:3b')).rejects.toThrow(
      'Install Ollama first: it’s what runs the model.',
    );
  });

  it('lets you pick among the models here, and only those', async () => {
    const { local } = await service({ world: { running: true, tags: [QWEN_TAG] } });
    await expect(local.choose('llama3.2:3b')).rejects.toThrow(/isn’t on this computer/);
    expect((await local.choose('qwen3:4b-instruct')).chosen).toBe('qwen3:4b-instruct');
  });
});

describe('Repair everything', () => {
  const signal = new AbortController().signal;

  it('starts a stopped Ollama someone uses, and says it fixed it', async () => {
    const { local, world } = await service({ models: true, world: { tags: [QWEN_TAG] } });
    const [look] = await local.doctorCheck().run({ repair: false, signal });
    expect(look).toMatchObject({
      state: 'warning',
      message: 'Ollama isn’t running. Repair starts it.',
    });
    expect(world.running).toBe(false);
    const [fixed] = await local.doctorCheck().run({ repair: true, signal });
    expect(fixed).toMatchObject({ state: 'fixed', message: 'Started Ollama. Qwen3 4B is ready.' });
    const [ok] = await local.doctorCheck().run({ repair: false, signal });
    expect(ok).toMatchObject({ state: 'ok', message: 'Qwen3 4B is ready.' });
  });

  it('asks for a person when Ollama won’t start', async () => {
    const { local } = await service({ models: true, startsOk: false });
    const [item] = await local.doctorCheck().run({ repair: true, signal });
    expect(item).toMatchObject({
      state: 'needs-you',
      action: { kind: 'open', place: 'providers', focus: 'ollama' },
    });
  });

  it('isn’t alarmed by an Ollama with no model', async () => {
    const { local } = await service({ world: { running: true } });
    const [item] = await local.doctorCheck().run({ repair: false, signal });
    expect(item).toMatchObject({ state: 'off', action: { label: 'Get a model' } });
  });
});

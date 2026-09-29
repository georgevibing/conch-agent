import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineId, EngineStatus, ServerEvent } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { OnePassword } from '../secrets/onepassword';
import { SecretVault } from '../secrets/vault';
import { SettingsStore } from '../settings/store';
import { fakeOp } from '../test/fakeOp';
import { ProviderKeys } from './keys';
import { ProviderSignIns } from './oauth';
import { ProviderError, ProviderService } from './service';

/** Narrow away `undefined` without a non-null assertion. */
function must<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`No ${what} in the list.`);
  return value;
}

/** The smallest thing that is an engine: it reports what the test wants. */
class FakeEngine implements Engine {
  readonly integrations = { mode: 'native' as const };
  keySeen: (string | undefined)[] = [];
  constructor(
    readonly id: EngineId,
    readonly label: string,
    private state: EngineStatus['state'] = 'ready',
    private readonly keys?: ProviderKeys,
  ) {}

  async detect(): Promise<EngineStatus> {
    // Key-based engines are only ready once a key is saved, like the real ones.
    const state = this.keys && !(await this.keys.has(this.id)) ? 'signed-out' : this.state;
    return {
      engine: this.id,
      label: this.label,
      state,
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
      ...(state === 'ready' && {
        auth: { method: 'api-key' as const, description: `${this.label} key` },
      }),
    };
  }

  async setApiKey(key: string | undefined) {
    this.keySeen.push(key);
  }

  async capabilities(): Promise<Capabilities> {
    return { engine: this.id, label: this.label, models: [], commands: [], permissionModes: [] };
  }

  async *runTurn(_input: TurnInput): AsyncIterable<EngineEvent> {
    yield { type: 'done', outcome: 'success' };
  }

  fail() {
    this.state = 'error';
  }
}

async function harness(options: { pinned?: EngineId; op?: OnePassword } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-providers-'));
  const settings = new SettingsStore(home);
  const keys = new ProviderKeys(settings, new SecretVault(options.op ?? new OnePassword()));
  const engines = new Map<EngineId, Engine>();
  engines.set('claude-code', new FakeEngine('claude-code', 'Claude Code'));
  engines.set('openrouter', new FakeEngine('openrouter', 'OpenRouter', 'ready', keys));
  engines.set('anthropic-api', new FakeEngine('anthropic-api', 'Anthropic API', 'ready', keys));
  engines.set('mock', new FakeEngine('mock', 'Test double'));
  const events: ServerEvent[] = [];
  const providers = new ProviderService({
    engines,
    settings,
    keys,
    pinned: options.pinned,
    emit: (event) => events.push(event),
  });
  return { home, settings, keys, engines, providers, events };
}

describe('ProviderService', () => {
  it('lists every provider, marks the one in use, and hides the test double', async () => {
    const { providers } = await harness();
    const list = await providers.list();
    expect(list.active).toBe('claude-code');
    expect(list.providers.map((p) => p.id)).toEqual(['claude-code', 'openrouter', 'anthropic-api']);
    const claude = must(list.providers[0], 'provider');
    expect(claude.active).toBe(true);
    expect(claude.name).toBe('Claude Code');
    expect(claude.tagline).toBe('Claude, on this computer');
    // Nothing is connected for OpenRouter yet, so it asks for a key.
    expect(must(list.providers[1]).status.state).toBe('signed-out');
    expect(must(list.providers[1]).keyForm?.label).toBe('OpenRouter key');
  });

  it('remembers the provider you chose', async () => {
    const { providers, settings, keys, events } = await harness();
    await keys.save('anthropic-api', 'sk-ant-0123456789');
    const list = await providers.use('anthropic-api');
    expect(list.active).toBe('anthropic-api');
    expect((await settings.get()).preferences.engine).toBe('anthropic-api');
    expect(providers.activeIdNow()).toBe('anthropic-api');
    expect(providers.engine().id).toBe('anthropic-api');
    expect(events.some((event) => event.type === 'engine.status')).toBe(true);
  });

  it('refuses to switch when CONCH_ENGINE pins the choice, and says why', async () => {
    const { providers } = await harness({ pinned: 'mock' });
    const list = await providers.list();
    expect(list.active).toBe('mock');
    expect(list.pinned).toContain('CONCH_ENGINE=mock');
    // Only the pinned one: the others couldn't be switched to anyway.
    expect(list.providers.map((p) => p.id)).toEqual(['mock']);
    await expect(providers.use('claude-code')).rejects.toThrow(/CONCH_ENGINE=mock/);
  });

  it('keeps a key out of the browser’s reach, describing it instead', async () => {
    const { providers } = await harness();
    const list = await providers.setKey('openrouter', 'sk-or-v1-0123456789abcd');
    const openrouter = must(list.providers.find((p) => p.id === 'openrouter'));
    expect(openrouter.key).toEqual({ source: 'conch', hint: '…abcd', savedAt: expect.any(Number) });
    expect(JSON.stringify(list)).not.toContain('sk-or-v1-0123456789abcd');
  });

  it('checks the shape of a key before keeping it, and keeps the old one on failure', async () => {
    const { providers, keys } = await harness();
    await providers.setKey('openrouter', 'sk-or-v1-first0000');
    await expect(providers.setKey('openrouter', 'ghp_wrong_kind_of_key')).rejects.toThrow(
      /start with sk-or-/,
    );
    expect(await keys.value('openrouter')).toBe('sk-or-v1-first0000');
  });

  it('tells the engine when a key changes, so it forgets what it knew', async () => {
    const { providers, engines } = await harness();
    const engine = engines.get('openrouter') as FakeEngine;
    await providers.setKey('openrouter', 'sk-or-v1-0123456789');
    await providers.clearKey('openrouter');
    expect(engine.keySeen).toEqual(['sk-or-v1-0123456789', undefined]);
  });

  it('turns a provider that won’t answer into a state, not an exception', async () => {
    const { providers, engines } = await harness();
    (engines.get('claude-code') as FakeEngine).fail();
    const list = await providers.list({ force: true });
    expect(must(list.providers[0]).status.state).toBe('error');
    expect(must(list.providers[0]).ready).toBe(false);
  });

  it('refuses a provider it has never heard of', async () => {
    const { providers } = await harness();
    await expect(providers.get('codex-cli')).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('keys in 1Password', () => {
  it('saves the reference, resolves the value, and never writes the key down', async () => {
    const op = await fakeOp();
    const onePassword = new OnePassword({ find: async () => op.bin });
    const { providers, home, keys } = await harness({ op: onePassword });

    const list = await providers.setKey('openrouter', op.reference);
    const openrouter = must(list.providers.find((p) => p.id === 'openrouter'));
    expect(openrouter.key).toMatchObject({ source: '1password', hint: op.reference });
    expect(await keys.value('openrouter')).toBe(op.value);

    const secrets = await readFile(join(home, 'secrets.json'), 'utf8');
    expect(secrets).toContain(op.reference);
    expect(secrets).not.toContain(op.value);
  });

  it('checks the reference really holds a key of the right shape', async () => {
    const op = await fakeOp({ value: 'not-an-openrouter-key' });
    const onePassword = new OnePassword({ find: async () => op.bin });
    const { providers, keys } = await harness({ op: onePassword });
    await expect(providers.setKey('openrouter', op.reference)).rejects.toThrow(/1Password field/);
    expect(await keys.stored('openrouter')).toBeUndefined();
  });

  it('says what to do when 1Password is locked', async () => {
    const op = await fakeOp({ locked: true });
    const onePassword = new OnePassword({ find: async () => op.bin });
    const { providers } = await harness({ op: onePassword });
    await expect(providers.setKey('openrouter', op.reference)).rejects.toThrow(/Unlock 1Password/);
  });

  it('refuses a reference that isn’t one', async () => {
    const op = await fakeOp();
    const onePassword = new OnePassword({ find: async () => op.bin });
    await expect(onePassword.read('op://Private/Item; rm -rf /')).rejects.toThrow(/looks like/);
  });

  it('says how to get 1Password when it isn’t here', async () => {
    const onePassword = new OnePassword({ find: async () => undefined });
    const state = await onePassword.state();
    expect(state.available).toBe(false);
    expect(state.installCommand).toBe('brew install 1password-cli');
    // Describing a saved secret must not ask 1Password for anything.
    const vault = new SecretVault(onePassword);
    const described = await vault.describe({
      source: '1password',
      reference: 'op://Private/Thing/credential',
      savedAt: 1,
    });
    expect(described.problem).toContain('1Password command line tool');
  });

  it('asks 1Password once, then answers from memory', async () => {
    const op = await fakeOp();
    const run = vi.fn(async (file: string, args: string[]) => {
      const { run: real } = await import('../lib/proc');
      return real(file, args);
    });
    const onePassword = new OnePassword({ find: async () => op.bin, run });
    expect(await onePassword.read(op.reference)).toBe(op.value);
    expect(await onePassword.read(op.reference)).toBe(op.value);
    // One `--version` and one `read`: the second read came from memory.
    expect(run.mock.calls.filter(([, args]) => args[0] === 'read')).toHaveLength(1);
    expect(onePassword.peek(op.reference)).toBe(op.value);
  });
});

describe('one-click keys', () => {
  const origin = 'http://localhost:4317';

  it('sends you to the provider with PKCE, and takes the key it sends back', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ key: 'sk-or-v1-minted', user_id: 'user_1' }),
    );
    const signIns = new ProviderSignIns(fetchImpl as unknown as typeof fetch);
    const { authorizeUrl, flowId } = signIns.start({
      providerId: 'openrouter',
      origin,
      display: 'popup',
    });
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe(`${origin}/oauth/provider/${flowId}`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // The verifier itself never leaves the gateway.
    expect(authorizeUrl).not.toContain('code_verifier');

    const done = await signIns.finish(flowId, 'the-code');
    expect(done).toMatchObject({ providerId: 'openrouter', key: 'sk-or-v1-minted' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      code: 'the-code',
      code_challenge_method: 'S256',
    });
  });

  it('spends a flow once, and forgets one that was never finished', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ key: 'sk-or-v1-minted' }));
    const signIns = new ProviderSignIns(fetchImpl as unknown as typeof fetch);
    const { flowId } = signIns.start({ providerId: 'openrouter', origin, display: 'tab' });
    await signIns.finish(flowId, 'code');
    await expect(signIns.finish(flowId, 'code')).rejects.toThrow(/took too long/);
    expect(signIns.peek(flowId)).toBeUndefined();
  });

  it('refuses a provider that can’t make a key, and an unknown flow', async () => {
    const signIns = new ProviderSignIns();
    expect(() => signIns.start({ providerId: 'claude-code', origin, display: 'popup' })).toThrow(
      /can’t make a key/,
    );
    await expect(signIns.finish('made-up', 'code')).rejects.toThrow(/took too long/);
  });

  it('reports a refused exchange in plain words', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 403 }));
    const signIns = new ProviderSignIns(fetchImpl as unknown as typeof fetch);
    const { flowId } = signIns.start({ providerId: 'openrouter', origin, display: 'popup' });
    await expect(signIns.finish(flowId, 'stale')).rejects.toThrow(/expired or was already used/);
  });
});

describe('ProviderKeys', () => {
  it('reads the key an older Conch saved, then retires it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-legacy-'));
    const settings = new SettingsStore(home);
    // Not key-shaped on purpose: Claude Code's key has no pattern to match, and
    // a fixture shouldn't read like a credential.
    await settings.setSecrets({ anthropicApiKey: 'the-older-key' });
    const keys = new ProviderKeys(settings);
    expect(await keys.value('claude-code')).toBe('the-older-key');

    await keys.save('claude-code', 'the-newer-key');
    const secrets = await settings.secrets();
    expect(secrets.anthropicApiKey).toBeUndefined();
    expect(await keys.value('claude-code')).toBe('the-newer-key');
  });

  it('does not wake 1Password up just to draw a page', async () => {
    const op = await fakeOp();
    const run = vi.fn(async (file: string, args: string[]) => {
      const { run: real } = await import('../lib/proc');
      return real(file, args);
    });
    const home = await mkdtemp(join(tmpdir(), 'conch-peek-'));
    const settings = new SettingsStore(home);
    const onePassword = new OnePassword({ find: async () => op.bin, run });
    const keys = new ProviderKeys(settings, new SecretVault(onePassword));
    await keys.save('openrouter', op.reference);
    expect(await keys.value('openrouter', { peek: true })).toBeUndefined();
    expect(run.mock.calls.some(([, args]) => args[0] === 'read')).toBe(false);
  });
});

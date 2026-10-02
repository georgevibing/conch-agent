import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  ConversationEvent,
  EngineId,
  EngineStatus,
  ModelInfo,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { appsNeeded } from '../providers/apps';
import { SettingsStore } from '../settings/store';
import { ConversationManager, type TurnRoute } from './manager';
import { ConversationStore } from './store';

const model = (id: string, label: string, tools?: boolean): ModelInfo => ({
  id,
  label,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
  ...(tools !== undefined && { tools }),
});

/** Answers "<model> heard: <prompt>", with the model it was asked for. */
class FakeEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];

  constructor(
    readonly id: EngineId,
    readonly label: string,
    readonly models: ModelInfo[],
  ) {}

  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }

  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: this.models,
      commands: [],
      permissionModes: ['default'],
      tools: { host: true, files: true, shell: false, approvals: true },
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: `${this.id}-s`, model: input.options.model ?? 'default' };
    yield {
      type: 'text',
      messageId: `m${Math.random()}`,
      delta: `${input.options.model ?? 'default'} heard: ${input.prompt}`,
    };
    yield { type: 'done', outcome: 'success' };
  }
}

const LINEAR = /\blinear\b/i;

async function setup(options: { others?: boolean } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-chat-only-'));
  const router = new FakeEngine('openrouter', 'OpenRouter', [
    model('tiny', 'Tiny', false),
    model('big', 'Big', true),
  ]);
  const claude = new FakeEngine('claude-code', 'Claude Code', [
    model('default', 'Default'),
    model('opus', 'Opus'),
  ]);
  const engines = new Map<EngineId, FakeEngine>([
    ['openrouter', router],
    ...(options.others === false ? [] : [['claude-code', claude] as const]),
  ]);
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  const engine = (id?: EngineId) => engines.get(id ?? 'openrouter') ?? router;
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine,
    route: async (e): Promise<TurnRoute> => ({ kind: 'use', engine: e }),
    appsNeeded: (input) =>
      appsNeeded(
        {
          about: async (text) =>
            LINEAR.test(text) ? [{ name: 'Linear', catalogId: 'linear' }] : [],
          catalog: async () => ({
            default: 'openrouter',
            providers: await Promise.all(
              [...engines.values()].map(async (e) => ({
                ...(await e.capabilities()),
                local: false,
              })),
            ),
          }),
          defaults: async () => ({ engine: 'openrouter' }),
        },
        input,
      ),
  });
  return { manager, router, claude };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 2000; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

const log = async (manager: ConversationManager, id: string): Promise<ConversationEvent[]> =>
  (await manager.detail(id)).events;

describe('a chat-only model and a message that needs an app (ADR 0050)', () => {
  it('waits with an offer of the same provider’s model that can — then switches and sends', async () => {
    const { manager, router } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'what’s assigned to me in Linear?',
      options: { engine: 'openrouter', model: 'tiny' },
    });
    const waiting = (await log(manager, convo.id)).find((e) => e.type === 'turn.needs-apps');
    expect(waiting).toMatchObject({
      needs: [{ kind: 'app', name: 'Linear', catalogId: 'linear' }],
      model: { engine: 'openrouter', id: 'tiny', label: 'Tiny' },
      switchTo: { engine: 'openrouter', model: 'big', label: 'Big', provider: 'OpenRouter' },
    });
    // Nothing went to the model that can't use it.
    expect(router.turns).toHaveLength(0);
    // The internet coming back isn't what it's waiting for.
    expect(await manager.releaseHeld()).toBe(0);

    expect(await manager.release(convo.id, 'openrouter', 'big')).toBe(true);
    await idle(manager, convo.id);
    expect(router.turns).toHaveLength(1);
    expect(router.turns[0]?.options.model).toBe('big');
    expect(router.turns[0]?.prompt).toContain('assigned to me in Linear');
    // The chat keeps the model you switched to, and the message wasn't sent twice.
    const events = await log(manager, convo.id);
    expect((await manager.detail(convo.id)).conversation.options).toMatchObject({
      engine: 'openrouter',
      model: 'big',
    });
    expect(events.filter((e) => e.type === 'user.message')).toHaveLength(1);
    expect(events.some((e) => e.type === 'turn.routed')).toBe(false);
  });

  it('answers without, when you’d rather — and asks once per model', async () => {
    const { manager, router } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'check Linear',
      options: { engine: 'openrouter', model: 'tiny' },
    });
    expect(await manager.release(convo.id)).toBe(true);
    await idle(manager, convo.id);
    expect(router.turns[0]?.options.model).toBe('tiny');

    // Asking about it again in this chat just answers: you chose already.
    await manager.send({
      conversationId: convo.id,
      clientMessageId: 'u2',
      text: 'and Linear now?',
    });
    await idle(manager, convo.id);
    expect(router.turns).toHaveLength(2);
    expect((await log(manager, convo.id)).filter((e) => e.type === 'turn.needs-apps')).toHaveLength(
      1,
    );
  });

  it('typing on instead of switching sends both, together', async () => {
    const { manager, router } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'look in Linear',
      options: { engine: 'openrouter', model: 'tiny' },
    });
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'never mind' });
    await idle(manager, convo.id);
    expect(router.turns).toHaveLength(1);
    expect(router.turns[0]?.prompt).toBe('look in Linear\n\nnever mind');
  });

  it('says nothing when the model can use apps, or the message needs none', async () => {
    const { manager, router } = await setup();
    const able = await manager.send({
      clientMessageId: 'u1',
      text: 'check Linear',
      options: { engine: 'openrouter', model: 'big' },
    });
    await idle(manager, able.id);
    const plain = await manager.send({
      clientMessageId: 'u2',
      text: 'tell me a joke',
      options: { engine: 'openrouter', model: 'tiny' },
    });
    await idle(manager, plain.id);
    expect(router.turns).toHaveLength(2);
    for (const id of [able.id, plain.id])
      expect((await log(manager, id)).some((e) => e.type === 'turn.needs-apps')).toBe(false);
  });

  it('a skill that says it needs tools counts; one that needs nothing doesn’t', async () => {
    const { router } = await setup();
    const words = { title: 'Poems', permissions: { declared: true, capabilities: [], words: [] } };
    const tools = {
      title: 'Weekly review',
      permissions: { declared: true, capabilities: ['files' as const], words: ['read files'] },
    };
    const deps = {
      about: async () => [],
      catalog: async () => ({
        default: 'openrouter' as const,
        providers: [{ ...(await router.capabilities()), local: false }],
      }),
      defaults: async () => ({}),
    };
    expect(
      await appsNeeded(deps, { text: 'go', engine: router, model: 'tiny', skill: words }),
    ).toBe(undefined);
    expect(
      await appsNeeded(deps, { text: 'go', engine: router, model: 'tiny', skill: tools }),
    ).toMatchObject({ needs: [{ kind: 'skill', name: 'Weekly review' }] });
  });

  it('with no model set up that can, there’s nothing to switch to', async () => {
    const { manager } = await setup({ others: false });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'check Linear',
      options: { engine: 'openrouter', model: 'tiny' },
    });
    // The same provider's model that can is still a choice you made.
    expect((await log(manager, convo.id)).find((e) => e.type === 'turn.needs-apps')).toMatchObject({
      switchTo: { model: 'big' },
    });
    const lonely = new FakeEngine('ollama', 'Ollama', [model('gemma', 'Gemma', false)]);
    expect(
      await appsNeeded(
        {
          about: async () => [{ name: 'Linear' }],
          catalog: async () => ({
            default: 'ollama',
            providers: [{ ...(await lonely.capabilities()), local: true }],
          }),
          defaults: async () => ({}),
        },
        { text: 'check Linear', engine: lonely },
      ),
    ).toEqual({
      needs: [{ kind: 'app', name: 'Linear' }],
      model: { engine: 'ollama', id: 'gemma', label: 'Gemma' },
    });
  });

  it('never stops a chat that came from a chat app', async () => {
    const { manager, router } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'check Linear',
      options: { engine: 'openrouter', model: 'tiny' },
      origin: { kind: 'channel', channelId: 'ch_1', channel: 'telegram' },
    });
    await idle(manager, convo.id);
    expect(router.turns).toHaveLength(1);
  });
});

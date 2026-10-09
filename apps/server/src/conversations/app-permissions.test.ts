import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALL_MODES,
  toolDecision,
  type Capabilities,
  type ConversationEvent,
  type EngineStatus,
  type IntegrationPolicy,
  type PermissionMode,
  type ToolPolicy,
} from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import type { LookModel } from '../memory/guard';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager, type AskRequest, type TurnIntegrationsProvider } from './manager';
import { ConversationStore } from './store';

const NAME = 'mcp__github__create_issue';
const REQUEST = { toolName: NAME, input: { title: 'A real change' } };

/** Native MCP and Conch's bridge must make the same permission decision. */
class AppEngine implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'App permissions';
  readonly integrations: { mode: 'native' | 'bridge' };
  script?: (input: TurnInput) => AsyncGenerator<EngineEvent>;

  constructor(mode: 'native' | 'bridge') {
    this.integrations = { mode };
  }
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
      models: [],
      commands: [],
      permissionModes: [...ALL_MODES],
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    if (this.script) yield* this.script(input);
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup({
  transport = 'bridge',
  mode = 'bypassPermissions',
  policy = 'ask-writes',
  toolPolicy,
  destructive = false,
  host,
  home: given,
  look,
  parallel = 1,
}: {
  transport?: 'native' | 'bridge';
  mode?: PermissionMode;
  policy?: IntegrationPolicy;
  toolPolicy?: ToolPolicy;
  destructive?: boolean;
  host?: Partial<AskRequest>;
  /** The same Conch again, as after a restart. */
  home?: string;
  /** What the small model behind the second look answers (ADR 0118); none: no model. */
  look?: string;
  /** How many of the host tool's calls run at once. */
  parallel?: number;
} = {}) {
  const home = given ?? (await mkdtemp(join(tmpdir(), 'conch-app-permissions-')));
  const engine = new AppEngine(transport);
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: { engine: 'mock', autoTitle: false, permissionMode: mode },
  });
  const call = vi.fn(async () => ({ text: 'Created', isError: false }));
  const integrations: TurnIntegrationsProvider = {
    forTurn: async () => ({
      servers: { github: { type: 'http', url: 'https://example.com/mcp' } },
      disallowedTools: [],
      issues: [],
    }),
    turnFailed: async () => [],
    bridge: async () => ({
      tools: [{ name: NAME, description: 'Create an issue', inputSchema: {}, call }],
      failed: [],
      close: async () => undefined,
    }),
    decide: async () =>
      toolDecision(
        {
          policy,
          tools: [
            {
              name: 'create_issue',
              description: '',
              access: 'write',
              destructive,
              ...(toolPolicy && { policy: toolPolicy }),
            },
          ],
        },
        'create_issue',
      ),
    describeTool: async () => ({
      integration: 'GitHub',
      tool: 'Create an issue',
      access: 'write',
      ...(destructive && { destructive: true }),
      ...(toolPolicy === 'ask' && { asks: true }),
    }),
    markUsed: async () => undefined,
  };
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    integrations,
    ...(look !== undefined && {
      riskLook: async () => ({ complete: async () => ({ text: look }) }) as unknown as LookModel,
    }),
    ...(host && {
      tools: (ctx) => [
        {
          name: 'app_change',
          description: 'An app hosted by Conch',
          input: {},
          run: async () => {
            const decision = await ctx.ask({
              toolName: 'app_change',
              input: {},
              summary: 'make a change',
              chosen: true,
              ...host,
            });
            if (decision !== 'deny') await call();
            return decision;
          },
        },
      ],
    }),
  });
  engine.script = async function* (input) {
    if (host) {
      const tool = input.tools.find((t) => t.name === 'app_change');
      await Promise.all(Array.from({ length: parallel }, () => tool?.run({})));
    } else {
      const guarded = await input.guard?.(REQUEST);
      if (guarded?.decision !== 'deny') {
        if (transport === 'bridge') {
          // The real bridge wrapper owns approval, even if an engine skips its own prompts.
          await input.bridgedTools?.[0]?.run(REQUEST.input, 'call1');
        } else if ((await input.requestPermission(REQUEST, input.signal)) !== 'deny') {
          await call();
        }
      }
    }
    yield { type: 'text', messageId: 'm', delta: 'Done' };
  };
  return { manager, call, integrations, home };
}

async function eventsUntil(
  manager: ConversationManager,
  id: string,
  type: 'permission.requested' | 'turn.completed',
  count = 1,
): Promise<ConversationEvent[]> {
  await vi.waitFor(async () => {
    const { events } = await manager.detail(id);
    expect(events.filter((e) => e.type === type).length).toBeGreaterThanOrEqual(count);
  });
  return (await manager.detail(id)).events;
}

async function answer(
  manager: ConversationManager,
  id: string,
  count = 1,
  decision: 'deny' | 'allow-always' = 'deny',
) {
  const events = await eventsUntil(manager, id, 'permission.requested', count);
  const request = events.findLast((e) => e.type === 'permission.requested');
  if (request?.type !== 'permission.requested') throw new Error('No question');
  await manager.respond(id, request.permissionId, decision);
}

describe.each(['native', 'bridge'] as const)('app permissions over %s', (transport) => {
  it.each(['ask', 'ask-writes'] as const)(
    'Full trust overrides %s without changing the saved policy',
    async (policy) => {
      const { manager, call, integrations } = await setup({ transport, policy });
      const convo = await manager.send({ clientMessageId: 'u1', text: 'create an issue' });
      const events = await eventsUntil(manager, convo.id, 'turn.completed');
      expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
      expect(call).toHaveBeenCalledOnce();
      expect(await integrations.decide(NAME)).toBe('ask');
    },
  );

  it('Full trust overrides a per-tool Ask, but never Off', async () => {
    for (const toolPolicy of ['ask', 'off'] as const) {
      const { manager, call } = await setup({ transport, policy: 'trust', toolPolicy });
      const convo = await manager.send({ clientMessageId: 'u1', text: 'create an issue' });
      const events = await eventsUntil(manager, convo.id, 'turn.completed');
      expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
      expect(call).toHaveBeenCalledTimes(toolPolicy === 'off' ? 0 : 1);
    }
  });

  it('switching to Full trust releases an app question; switching back restores it', async () => {
    const { manager, call } = await setup({ transport, mode: 'default' });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'create an issue' });
    await eventsUntil(manager, convo.id, 'permission.requested');
    expect(call).not.toHaveBeenCalled();
    await manager.configure(convo.id, { permissionMode: 'bypassPermissions' });
    await eventsUntil(manager, convo.id, 'turn.completed');
    expect(call).toHaveBeenCalledOnce();
    await manager.configure(convo.id, { permissionMode: 'default' });
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'another issue' });
    await answer(manager, convo.id, 2);
    await eventsUntil(manager, convo.id, 'turn.completed', 2);
    expect(call).toHaveBeenCalledOnce();
  });

  it.each(['ask', 'ask-writes'] as const)(
    'Auto overrides %s like Full trust does (ADR 0100)',
    async (policy) => {
      const { manager, call } = await setup({ transport, policy, mode: 'auto' });
      const convo = await manager.send({ clientMessageId: 'u1', text: 'create an issue' });
      const events = await eventsUntil(manager, convo.id, 'turn.completed');
      expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
      expect(call).toHaveBeenCalledOnce();
    },
  );

  it('Auto keeps a tool you set to Ask, and asks before a tool that deletes', async () => {
    for (const options of [
      { toolPolicy: 'ask' as const, policy: 'trust' as const },
      { destructive: true, policy: 'ask-writes' as const },
    ]) {
      const { manager, call } = await setup({ transport, mode: 'auto', ...options });
      const convo = await manager.send({ clientMessageId: 'u1', text: 'create an issue' });
      const events = await eventsUntil(manager, convo.id, 'permission.requested');
      const asked = events.find((e) => e.type === 'permission.requested');
      if (options.destructive)
        expect(asked).toMatchObject({ taint: expect.stringContaining('delete something') });
      await answer(manager, convo.id);
      await eventsUntil(manager, convo.id, 'turn.completed');
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('a tool that deletes asks in every mode but Full trust, unless you said don’t ask', async () => {
    for (const mode of ['default', 'auto'] as const) {
      const allowed = await setup({ transport, mode, policy: 'trust', destructive: true });
      const quiet = await allowed.manager.send({ clientMessageId: 'u1', text: 'delete it' });
      const events = await eventsUntil(allowed.manager, quiet.id, 'turn.completed');
      expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
      expect(allowed.call).toHaveBeenCalledOnce();
    }
    const full = await setup({ transport, policy: 'ask-writes', destructive: true });
    const convo = await full.manager.send({ clientMessageId: 'u1', text: 'delete it' });
    const events = await eventsUntil(full.manager, convo.id, 'turn.completed');
    expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
  });

  it('Auto checks an app write once the chat read something', async () => {
    const { manager, call } = await setup({ transport, mode: 'auto' });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'create an issue',
      untrusted: { kind: 'web', label: 'evil.example' },
    });
    const events = await eventsUntil(manager, convo.id, 'permission.requested');
    expect(events.find((e) => e.type === 'permission.requested')).toMatchObject({
      taint: expect.stringContaining('evil.example'),
    });
    await answer(manager, convo.id);
    await eventsUntil(manager, convo.id, 'turn.completed');
    expect(call).not.toHaveBeenCalled();
  });

  it('Full trust still checks an app write after someone else’s words', async () => {
    const { manager, call } = await setup({ transport });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'create an issue',
      untrusted: { kind: 'person', label: 'someone else' },
    });
    await answer(manager, convo.id);
    await eventsUntil(manager, convo.id, 'turn.completed');
    expect(call).not.toHaveBeenCalled();
  });
});

describe('apps hosted by Conch', () => {
  it.each([{}, { once: true }])(
    'Auto skips an app’s own Ask, and shows words to other people only after reading: %j',
    async (host) => {
      const { manager, call } = await setup({ host, mode: 'auto' });
      const quiet = await manager.send({ clientMessageId: 'u1', text: 'make a change' });
      const events = await eventsUntil(manager, quiet.id, 'turn.completed');
      expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
      expect(call).toHaveBeenCalledOnce();
    },
  );

  it('Full trust sends what goes to other people without the preview (ADR 0100)', async () => {
    const { manager, call } = await setup({ host: { once: true } });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'send it' });
    const events = await eventsUntil(manager, convo.id, 'turn.completed');
    expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it('Auto asks before a step of Conch’s own that deletes in an app', async () => {
    const { manager, call } = await setup({
      host: { toolName: 'google_calendar_delete_event' },
      mode: 'auto',
    });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'delete the meeting' });
    const events = await eventsUntil(manager, convo.id, 'permission.requested');
    expect(events.find((e) => e.type === 'permission.requested')).toMatchObject({
      taint: expect.stringContaining('delete something in one of your apps'),
    });
    await answer(manager, convo.id);
    await eventsUntil(manager, convo.id, 'turn.completed');
    expect(call).not.toHaveBeenCalled();
  });

  it('Full trust skips an app’s own Ask question', async () => {
    const { manager, call } = await setup({ host: {} });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'make a change' });
    const events = await eventsUntil(manager, convo.id, 'turn.completed');
    expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it('Full trust releases a waiting app question and applies to the next turn too', async () => {
    const { manager, call } = await setup({ host: {}, mode: 'default' });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'make a change' });
    await eventsUntil(manager, convo.id, 'permission.requested');
    await manager.configure(convo.id, { permissionMode: 'bypassPermissions' });
    await eventsUntil(manager, convo.id, 'turn.completed');
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'again' });
    const events = await eventsUntil(manager, convo.id, 'turn.completed', 2);
    expect(events.filter((e) => e.type === 'permission.requested')).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([{ once: true }, { taint: 'Someone else’s words need checking.' }])(
    'Full trust preserves mandatory app confirmation: %j',
    async (host) => {
      const { manager, call } = await setup({ host, mode: 'default' });
      const convo = await manager.send({
        clientMessageId: 'u1',
        text: 'make a change',
        untrusted: { kind: 'person', label: 'someone else' },
      });
      await eventsUntil(manager, convo.id, 'permission.requested');
      await manager.configure(convo.id, { permissionMode: 'bypassPermissions' });
      expect(call).not.toHaveBeenCalled();
      await answer(manager, convo.id);
      await eventsUntil(manager, convo.id, 'turn.completed');
      await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'again' });
      await answer(manager, convo.id, 2);
      await eventsUntil(manager, convo.id, 'turn.completed', 2);
      expect(call).not.toHaveBeenCalled();
    },
  );
});

describe('steps in your own apps, after reading (ADR 0117)', () => {
  const READ = 'This chat read evil.example, which could be trying to steer me.';
  const own = (toolName: string, access: 'read' | 'write' = 'write') => ({
    toolName,
    taint: `${READ} So I’m checking before I change things in Yazio.`,
    chosen: true,
    appStep: { access, own: true },
  });

  it('Auto lets an ordinary change in an app you made go ahead after reading', async () => {
    const { manager, call } = await setup({ host: own('app_yazio__add_food'), mode: 'auto' });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'log my lunch',
      untrusted: { kind: 'web', label: 'evil.example' },
    });
    const events = await eventsUntil(manager, convo.id, 'turn.completed');
    expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it.each([
    ['app_yazio__send_weekly_report', 'send something to other people'],
    ['app_yazio__delete_entries', 'delete something in one of your apps'],
    ['app_shop__pay_invoice', 'spend money in one of your apps'],
  ])('Auto still asks before %s after reading, with the reason', async (toolName, reason) => {
    const { manager, call } = await setup({ host: own(toolName), mode: 'auto' });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'do it',
      untrusted: { kind: 'web', label: 'evil.example' },
    });
    const events = await eventsUntil(manager, convo.id, 'permission.requested');
    expect(events.find((e) => e.type === 'permission.requested')).toMatchObject({
      taint: expect.stringContaining(reason),
    });
    await answer(manager, convo.id);
    await eventsUntil(manager, convo.id, 'turn.completed');
    expect(call).not.toHaveBeenCalled();
  });

  it('a stranger’s app, or someone else’s words, still ask as before', async () => {
    const stranger = await setup({
      host: { ...own('app_weather__save_city'), appStep: { access: 'write', own: false } },
      mode: 'auto',
    });
    const one = await stranger.manager.send({
      clientMessageId: 'u1',
      text: 'save it',
      untrusted: { kind: 'web', label: 'evil.example' },
    });
    await answer(stranger.manager, one.id);
    await eventsUntil(stranger.manager, one.id, 'turn.completed');
    expect(stranger.call).not.toHaveBeenCalled();
    const guest = await setup({ host: own('app_yazio__add_food'), mode: 'auto' });
    const two = await guest.manager.send({
      clientMessageId: 'u1',
      text: 'log it',
      untrusted: { kind: 'person', label: 'someone else' },
    });
    await answer(guest.manager, two.id);
    await eventsUntil(guest.manager, two.id, 'turn.completed');
    expect(guest.call).not.toHaveBeenCalled();
  });

  it('“Always allow” holds for that tool after Conch restarts', async () => {
    const first = await setup({ host: {}, mode: 'default' });
    const convo = await first.manager.send({ clientMessageId: 'u1', text: 'make a change' });
    await answer(first.manager, convo.id, 1, 'allow-always');
    await eventsUntil(first.manager, convo.id, 'turn.completed');
    expect(first.call).toHaveBeenCalledOnce();
    const again = await setup({ host: {}, mode: 'default', home: first.home });
    await again.manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'again' });
    const events = await eventsUntil(again.manager, convo.id, 'turn.completed', 2);
    expect(events.filter((e) => e.type === 'permission.requested')).toHaveLength(1);
    expect(again.call).toHaveBeenCalledOnce();
  });

  it('“Always allow” after reading holds after a restart too, for that tool only', async () => {
    const host = { toolName: 'app_weather__save_city', taint: `${READ} So I’m checking.` };
    const first = await setup({ host, mode: 'default' });
    const convo = await first.manager.send({
      clientMessageId: 'u1',
      text: 'save it',
      untrusted: { kind: 'web', label: 'evil.example' },
    });
    await answer(first.manager, convo.id, 1, 'allow-always');
    await eventsUntil(first.manager, convo.id, 'turn.completed');
    const again = await setup({ host, mode: 'default', home: first.home });
    await again.manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'again' });
    const events = await eventsUntil(again.manager, convo.id, 'turn.completed', 2);
    expect(events.filter((e) => e.type === 'permission.requested')).toHaveLength(1);
    expect(again.call).toHaveBeenCalledOnce();
  });
});

describe('steps in someone else’s app, after reading, in Auto (ADR 0118)', () => {
  const READ = 'This chat read evil.example, which could be trying to steer me.';
  const stranger = (
    toolName: string,
    access: 'read' | 'write',
    input: Record<string, unknown> = {},
    allowed = false,
  ) => ({
    toolName,
    input,
    taint: `${READ} So I’m checking before I ${access === 'read' ? 'send what it asks for to api.example.com' : 'change things in Weather'}.`,
    appStep: {
      access,
      own: false,
      app: 'Weather',
      tool: toolName,
      ...(allowed && { allowed: true }),
    },
  });
  const SAFE = '{"risky": false, "kind": "none"}';
  const read = { kind: 'web' as const, label: 'evil.example' };

  /** Runs one turn in a chat that read evil.example; the questions it asked, answered no. */
  async function run(options: Parameters<typeof setup>[0]) {
    const { manager, call } = await setup({ mode: 'auto', ...options });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'do it', untrusted: read });
    await vi.waitFor(async () => {
      const { events } = await manager.detail(convo.id);
      const waiting = events.filter((e) => e.type === 'permission.requested');
      for (const e of waiting)
        if (
          e.type === 'permission.requested' &&
          !events.some((r) => r.type === 'permission.resolved' && r.permissionId === e.permissionId)
        )
          await manager.respond(convo.id, e.permissionId, 'deny');
      expect(events.some((e) => e.type === 'turn.completed')).toBe(true);
    });
    const { events } = await manager.detail(convo.id);
    return { call, asked: events.filter((e) => e.type === 'permission.requested') };
  }

  it('a lookup that sends no more than a lookup goes by itself, without a model', async () => {
    const { call, asked } = await run({
      host: stranger('app_weather__forecast', 'read', { city: 'Berlin' }),
    });
    expect(asked).toEqual([]);
    expect(call).toHaveBeenCalledOnce();
  });

  it('a lookup that sends more, or a change, gets a second look: it goes when the look sees nothing', async () => {
    const long = { note: 'my week of meals '.repeat(10) };
    for (const host of [
      stranger('app_weather__forecast', 'read', long),
      stranger('app_weather__save_city', 'write', { city: 'Berlin' }),
    ]) {
      const quiet = await run({ host, look: SAFE });
      expect(quiet.asked).toEqual([]);
      expect(quiet.call).toHaveBeenCalledOnce();
      // No model to look: its own question stands, as before.
      const asked = await run({ host });
      expect(asked.asked).toHaveLength(1);
      expect(asked.call).not.toHaveBeenCalled();
    }
  });

  it('asks with the look’s reason when the look sees a risk', async () => {
    const { call, asked } = await run({
      host: stranger('app_weather__save_city', 'write', { city: 'Berlin' }),
      look: '{"risky": true, "kind": "speak"}',
    });
    expect(asked[0]).toMatchObject({
      taint: expect.stringContaining('speak for you to other people'),
    });
    expect(call).not.toHaveBeenCalled();
  });

  it('the person’s Allow for that tool is their answer: no look needed', async () => {
    const { call, asked } = await run({
      host: stranger('app_weather__save_city', 'write', { city: 'Berlin' }, true),
    });
    expect(asked).toEqual([]);
    expect(call).toHaveBeenCalledOnce();
  });

  it('what the rules mark asks whatever the look or Allow say: a key sent to an app', async () => {
    const key = `${'gh' + 'p_'}${'Z9y8X7w6'.repeat(5)}`;
    const { call, asked } = await run({
      host: stranger('app_weather__forecast', 'read', { city: key }, true),
      look: SAFE,
    });
    expect(asked[0]).toMatchObject({ taint: expect.stringContaining('looks like a key or token') });
    expect(call).not.toHaveBeenCalled();
  });

  it('a batch of lookups asked at once is one card, and its answer is theirs', async () => {
    const host = stranger('app_weather__forecast', 'read', {
      note: 'what to wear in the rain '.repeat(7),
    });
    const { manager, call } = await setup({ mode: 'auto', host, parallel: 5 });
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'look them up',
      untrusted: read,
    });
    const events = await eventsUntil(manager, convo.id, 'permission.requested');
    const request = events.find((e) => e.type === 'permission.requested');
    if (request?.type !== 'permission.requested') throw new Error('No question');
    await manager.respond(convo.id, request.permissionId, 'allow');
    const done = await eventsUntil(manager, convo.id, 'turn.completed');
    expect(done.filter((e) => e.type === 'permission.requested')).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(5);
  });
});

describe.each(['native', 'bridge'] as const)(
  'a change in a connected app, after reading, in Auto over %s (ADR 0118)',
  (transport) => {
    const read = { kind: 'web' as const, label: 'evil.example' };
    async function after(options: Parameters<typeof setup>[0]) {
      const { manager, call } = await setup({ transport, mode: 'auto', ...options });
      const convo = await manager.send({
        clientMessageId: 'u1',
        text: 'create an issue',
        untrusted: read,
      });
      return { manager, call, convo };
    }

    it('goes when the second look sees nothing, or when you set the tool to Allow', async () => {
      for (const options of [
        { look: '{"risky": false, "kind": "none"}' },
        { toolPolicy: 'allow' as const },
      ]) {
        const { manager, call, convo } = await after(options);
        const events = await eventsUntil(manager, convo.id, 'turn.completed');
        expect(events.some((e) => e.type === 'permission.requested')).toBe(false);
        expect(call).toHaveBeenCalledOnce();
      }
    });

    it('asks with the look’s reason when it sees a risk', async () => {
      const { manager, call, convo } = await after({ look: '{"risky": true, "kind": "speak"}' });
      const events = await eventsUntil(manager, convo.id, 'permission.requested');
      expect(events.find((e) => e.type === 'permission.requested')).toMatchObject({
        taint: expect.stringContaining('speak for you to other people'),
      });
      await answer(manager, convo.id);
      await eventsUntil(manager, convo.id, 'turn.completed');
      expect(call).not.toHaveBeenCalled();
    });
  },
);

describe('an email the person changes before allowing it', () => {
  const change = { to: ['kim@example.org'], subject: 'Lunch on Friday', body: 'Noon works.' };
  /** Asks in Default, answers with `decision` and `edit`, and says what was decided. */
  async function asked(
    host: Partial<AskRequest>,
    decision: 'allow' | 'allow-always' | 'deny',
    edit?: typeof change,
  ) {
    const { manager, call } = await setup({ host: { once: true, ...host }, mode: 'default' });
    const convo = await manager.send({ clientMessageId: 'u1', text: 'send it' });
    const events = await eventsUntil(manager, convo.id, 'permission.requested');
    const request = events.find((e) => e.type === 'permission.requested');
    if (request?.type !== 'permission.requested') throw new Error('No question');
    await manager.respond(convo.id, request.permissionId, decision, edit);
    const after = await eventsUntil(manager, convo.id, 'turn.completed');
    const resolved = after.find((e) => e.type === 'permission.resolved');
    return {
      request,
      call,
      decision: resolved?.type === 'permission.resolved' ? resolved.decision : undefined,
    };
  }

  it('says the question can be changed, and hands the change to it before going ahead', async () => {
    const edit = vi.fn();
    const { request, call, decision } = await asked({ edit }, 'allow', change);
    expect(request).toMatchObject({ editable: true, once: true });
    expect(edit).toHaveBeenCalledWith(change);
    expect(decision).toBe('allow');
    expect(call).toHaveBeenCalledOnce();
  });

  it('is a no when the question can’t take the change, never a yes to the old words', async () => {
    const edit = vi.fn(() => {
      throw new Error('not an email');
    });
    const refused = await asked({ edit }, 'allow', change);
    expect(refused.decision).toBe('deny');
    expect(refused.call).not.toHaveBeenCalled();
    // A question that can't be changed at all: a change sent to it is a no too.
    const fixed = await asked({}, 'allow', change);
    expect(fixed.request.editable).toBeUndefined();
    expect(fixed.decision).toBe('deny');
    expect(fixed.call).not.toHaveBeenCalled();
  });

  it('allows a change this once only, and a no stays a no', async () => {
    const edit = vi.fn();
    expect((await asked({ edit }, 'allow-always', change)).decision).toBe('allow');
    const no = await asked({ edit: vi.fn() }, 'deny', change);
    expect(no.decision).toBe('deny');
    expect(no.call).not.toHaveBeenCalled();
  });
});

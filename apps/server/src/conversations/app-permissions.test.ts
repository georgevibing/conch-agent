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
}: {
  transport?: 'native' | 'bridge';
  mode?: PermissionMode;
  policy?: IntegrationPolicy;
  toolPolicy?: ToolPolicy;
  destructive?: boolean;
  host?: Partial<AskRequest>;
} = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-app-permissions-'));
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
      await input.tools.find((t) => t.name === 'app_change')?.run({});
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
  return { manager, call, integrations };
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

async function answer(manager: ConversationManager, id: string, count = 1) {
  const events = await eventsUntil(manager, id, 'permission.requested', count);
  const request = events.findLast((e) => e.type === 'permission.requested');
  if (request?.type !== 'permission.requested') throw new Error('No question');
  await manager.respond(id, request.permissionId, 'deny');
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

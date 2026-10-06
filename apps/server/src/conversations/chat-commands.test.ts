/**
 * Conch's own chat commands, done by the gateway so they work the same with
 * every provider: `/clear` (and its Undo), `/goal`, and `/plan`'s approval —
 * Claude Code asks to start by itself; any other engine gets `exit_plan_mode`.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  ConversationEvent,
  EngineId,
  EngineStatus,
  PermissionMode,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, HostTool, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { PLAN_MODE_PROMPT } from '../plans/mode';
import { SettingsStore } from '../settings/store';
import { ConversationManager, modeBeforePlan } from './manager';
import { ConversationStore } from './store';

const MODES: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions'];

class Scripted implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  /** What the engine's own `ExitPlanMode` question said, for a native one. */
  readonly planApproval?: 'native';
  /** In the next turn, present this plan (with Conch's tool, or the engine's own question). */
  plan?: string;
  /** What came back from presenting it. */
  heard?: string;
  #sessions = 0;

  constructor(
    readonly id: EngineId,
    readonly label: string,
    native = false,
  ) {
    if (native) this.planApproval = 'native';
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
      permissionModes: MODES,
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield {
      type: 'session',
      resumeId: input.resumeId ?? `${this.id}-${++this.#sessions}`,
      model: 'm',
    };
    if (this.plan) {
      const plan = this.plan;
      this.plan = undefined;
      if (this.planApproval === 'native') {
        const decision = await input.requestPermission(
          { toolName: 'ExitPlanMode', toolUseId: 't1', input: { plan } },
          input.signal,
        );
        this.heard = decision;
      } else {
        const tool = input.tools?.find((t) => t.name === 'exit_plan_mode') as HostTool | undefined;
        this.heard = tool ? String(await tool.run({ plan })) : 'no tool';
      }
      // The mode the rest of the turn runs in.
      this.heard += ` | ${input.options.permissionMode}`;
    }
    yield { type: 'text', messageId: `m${this.turns.length}`, delta: 'ok' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-commands-'));
  const api = new Scripted('openrouter', 'OpenRouter');
  const claude = new Scripted('claude-code', 'Claude Code', true);
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: (id) => (id === 'claude-code' ? claude : api),
  });
  // Whoever is watching presses Start on every plan.
  manager.events.on((event) => {
    if (
      event.type === 'conversation.event' &&
      event.event.type === 'permission.requested' &&
      event.event.toolName === 'ExitPlanMode'
    ) {
      const { conversationId, permissionId } = event.event;
      setTimeout(() => void manager.respond(conversationId, permissionId, 'allow'), 0);
    }
  });
  return { manager, api, claude };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 400; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

async function say(
  manager: ConversationManager,
  text: string,
  id?: string,
  more: { engine?: EngineId; goal?: string } = {},
) {
  const convo = await manager.send({
    ...(id && { conversationId: id }),
    clientMessageId: `u-${text}-${Math.random()}`,
    text,
    ...(more.engine && { options: { engine: more.engine } }),
    ...(more.goal && { goal: more.goal }),
  });
  await idle(manager, convo.id);
  return convo.id;
}

const kinds = (events: ConversationEvent[]) => events.map((e) => e.type);

describe('/clear', () => {
  it('starts every provider afresh and hands over nothing from before', async () => {
    const { manager, api, claude } = await setup();
    const id = await say(manager, 'the secret word is pumpkin');
    await say(manager, 'and with Claude', id, { engine: 'claude-code' });
    expect(await manager.clear(id)).toMatchObject({ changed: true });

    await say(manager, 'what was the word?', id, { engine: 'openrouter' });
    const after = api.turns.at(-1);
    expect(after?.resumeId).toBeUndefined();
    expect(after?.prompt).toBe('what was the word?');

    // Another provider that took part before the clear forgets too, and gets
    // only what was said after it.
    await say(manager, 'still there?', id, { engine: 'claude-code' });
    const later = claude.turns.at(-1);
    expect(later?.resumeId).toBeUndefined();
    expect(later?.prompt).toContain('what was the word?');
    expect(later?.prompt).not.toContain('pumpkin');
  });

  it('keeps every message for the person, and says when there’s nothing to clear', async () => {
    const { manager } = await setup();
    const id = await say(manager, 'hello');
    await manager.clear(id);
    expect(await manager.clear(id)).toMatchObject({ changed: false });
    const { events } = await manager.detail(id);
    expect(kinds(events).filter((k) => k === 'context.cleared')).toHaveLength(1);
    expect(events.some((e) => e.type === 'user.message' && e.text === 'hello')).toBe(true);
  });

  it('can be undone until something is sent, and then the session carries on', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'one');
    await manager.clear(id);
    expect(await manager.restoreContext(id)).toMatchObject({ changed: true });
    await say(manager, 'two', id);
    expect(api.turns.at(-1)?.resumeId).toBe('openrouter-1');

    await manager.clear(id);
    await say(manager, 'three', id);
    expect(await manager.restoreContext(id)).toMatchObject({ changed: false });
    expect(api.turns.at(-1)?.resumeId).toBeUndefined();
  });
});

describe('/goal', () => {
  it('is in every turn’s context, through /clear, until it’s taken away', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'hi', undefined, { goal: 'Ship the release notes' });
    expect(api.turns.at(-1)?.systemAppend).toContain('“Ship the release notes”');

    await manager.clear(id);
    await say(manager, 'next', id);
    expect(api.turns.at(-1)?.systemAppend).toContain('Ship the release notes');

    await manager.setGoal(id, null);
    await say(manager, 'and now', id);
    expect(api.turns.at(-1)?.systemAppend).not.toContain('<chat-goal>');
  });

  it('logs a change once, not a repeat', async () => {
    const { manager } = await setup();
    const id = await say(manager, 'hi');
    await manager.setGoal(id, 'Tidy the garden');
    await manager.setGoal(id, 'Tidy the garden  ');
    const { events } = await manager.detail(id);
    expect(kinds(events).filter((k) => k === 'goal')).toHaveLength(1);
  });
});

describe('/plan', () => {
  it('gives an engine without its own question exit_plan_mode, and Start ends plan mode', async () => {
    const { manager, api } = await setup();
    const id = await say(manager, 'hi');
    await manager.configure(id, { permissionMode: 'acceptEdits' });
    await manager.configure(id, { permissionMode: 'plan' });
    api.plan = '1. Read\n2. Fix';
    await say(manager, 'fix the bug', id);
    expect(api.turns.at(-1)?.systemAppend).toContain(PLAN_MODE_PROMPT);
    expect(api.heard).toMatch(/^The person chose Start\..*\| acceptEdits$/);
    const { conversation, events } = await manager.detail(id);
    // Back to the mode it had before plan mode.
    expect(conversation.options.permissionMode).toBe('acceptEdits');
    expect(
      events.some((e) => e.type === 'permission.requested' && e.toolName === 'ExitPlanMode'),
    ).toBe(true);
  });

  it('leaves the question to an engine that asks by itself, and Start still ends plan mode', async () => {
    const { manager, claude } = await setup();
    const id = await say(manager, 'hi', undefined, { engine: 'claude-code' });
    await manager.configure(id, { permissionMode: 'plan' });
    claude.plan = 'The plan';
    await say(manager, 'do it', id);
    expect(claude.turns.at(-1)?.tools?.some((t) => t.name === 'exit_plan_mode')).toBe(false);
    expect(claude.turns.at(-1)?.systemAppend).not.toContain('<plan-mode>');
    expect(claude.heard).toBe('allow | default');
    // It had no mode of its own before: it follows your default again.
    expect((await manager.detail(id)).conversation.options.permissionMode).toBeUndefined();
  });

  it('asks in a chat app too, where Start is a button, but never a guest in a group', async () => {
    const { manager, api } = await setup();
    const origin = { kind: 'channel' as const, channelId: 'ch_one', channel: 'telegram' as const };
    const convo = await manager.send({
      clientMessageId: 'u-chat-app',
      text: 'hi',
      origin,
      options: { permissionMode: 'plan' },
    });
    await idle(manager, convo.id);
    expect(api.turns.at(-1)?.tools?.some((t) => t.name === 'exit_plan_mode')).toBe(true);
    const guest = await manager.send({
      clientMessageId: 'u-guest',
      text: 'hi',
      origin: { ...origin, group: 'Family', guest: true },
      options: { permissionMode: 'plan' },
    });
    await idle(manager, guest.id);
    expect(api.turns.at(-1)?.tools?.some((t) => t.name === 'exit_plan_mode')).toBe(false);
  });

  it('is not offered outside plan mode', async () => {
    const { manager, api } = await setup();
    await say(manager, 'hi');
    expect(api.turns.at(-1)?.tools?.some((t) => t.name === 'exit_plan_mode')).toBe(false);
  });
});

describe('modeBeforePlan', () => {
  const options = (seq: number, permissionMode?: PermissionMode): ConversationEvent => ({
    conversationId: 'c',
    seq,
    at: 0,
    type: 'options',
    options: permissionMode ? { permissionMode } : {},
  });

  it('reads the mode from before the latest switch into plan mode', () => {
    expect(modeBeforePlan([options(0, 'auto'), options(1, 'plan')])).toBe('auto');
    expect(modeBeforePlan([options(0, 'auto'), options(1, 'plan'), options(2, 'plan')])).toBe(
      'auto',
    );
    expect(modeBeforePlan([options(0), options(1, 'plan')])).toBeUndefined();
    expect(modeBeforePlan([options(0, 'plan')])).toBeUndefined();
    expect(modeBeforePlan([])).toBeUndefined();
  });
});

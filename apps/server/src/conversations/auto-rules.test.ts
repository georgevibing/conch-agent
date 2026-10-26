/**
 * The narrower Always allow (ADR 0149): a card in Auto can offer one command, word for word,
 * never asked about again. Kept only from a person's press; checked in `askUser`, the one
 * place a question reaches the person; never for a step no words lift.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALL_MODES,
  type AutoRule,
  type Capabilities,
  type ConversationEvent,
  type EngineStatus,
  type TaintSource,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { authorizeTool } from '../engines/host';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

/** Runs each command through Conch's authorization, outside the sealed box, as Codex does. */
class Scripted implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  commands: string[] = [];
  readonly outcomes: string[] = [];

  async detect(): Promise<EngineStatus> {
    return {
      engine: 'mock',
      label: 'Scripted',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: 'mock',
      label: 'Scripted',
      models: [],
      commands: [],
      permissionModes: [...ALL_MODES],
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    for (const [i, command] of this.commands.entries()) {
      const refused = await authorizeTool(
        input,
        'Bash',
        { command, dangerouslyDisableSandbox: true },
        `t${i}`,
      );
      this.outcomes.push(refused ? 'declined' : 'ran');
    }
    yield { type: 'done', outcome: 'success' };
  }
}

type Asked = Extract<ConversationEvent, { type: 'permission.requested' }>;
interface Answer {
  decision: 'allow' | 'allow-always' | 'deny';
  rule?: boolean;
}

async function setup(given: AutoRule[] = []) {
  const home = await mkdtemp(join(tmpdir(), 'conch-auto-rules-'));
  const workspace = await mkdtemp(join(tmpdir(), 'conch-auto-rules-work-'));
  const engine = new Scripted();
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: {
      engine: 'mock',
      autoTitle: false,
      permissionMode: 'auto',
      workspace,
      autoRules: given,
    },
  });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
  });
  /** One chat: these commands, every question answered so, and recorded. */
  const chat = async (
    commands: string[],
    answer: Answer = { decision: 'deny' },
    options: { text?: string; read?: TaintSource } = {},
  ) => {
    engine.commands = commands;
    engine.outcomes.length = 0;
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: options.text ?? 'Tidy the infrastructure',
      ...(options.read && { untrusted: options.read }),
    });
    const asked: Asked[] = [];
    let events: ConversationEvent[] = [];
    for (let i = 0; i < 4000; i++) {
      const detail = await manager.detail(convo.id);
      events = detail.events;
      for (const e of events)
        if (
          e.type === 'permission.requested' &&
          !asked.some((a) => a.permissionId === e.permissionId)
        ) {
          asked.push(e);
          await manager.respond(
            convo.id,
            e.permissionId,
            answer.decision,
            undefined,
            undefined,
            answer.rule,
          );
        }
      if (events.some((e) => e.type === 'turn.completed') && detail.conversation.status === 'idle')
        break;
      await new Promise((r) => setTimeout(r, 5));
    }
    return { asked, outcomes: [...engine.outcomes], events };
  };
  const rules = async () => (await settings.get()).preferences.autoRules;
  return { chat, rules, workspace };
}

const DEV = 'terraform apply -target=module.dev';

describe('Always allow one command (ADR 0149)', () => {
  it('offers the command on the card, keeps it from the press, and asks no more', async () => {
    const { chat, rules, workspace } = await setup();
    const web: TaintSource = { kind: 'web', label: 'docs.example' };
    // A push to a branch asks only once the chat has read something: a rule can lift that.
    const first = await chat(
      ['git push origin feature/login'],
      { decision: 'allow', rule: true },
      { read: web },
    );
    expect(first.asked).toHaveLength(1);
    expect(first.asked[0]?.rule).toBe('git push origin feature/*');
    expect(first.outcomes).toEqual(['ran']);
    expect(await rules()).toEqual([
      expect.objectContaining({
        tool: 'Bash',
        prefix: ['git', 'push', 'origin', 'feature/*'],
        cwd: workspace,
      }),
    ]);
    const resolved = first.events.find((e) => e.type === 'permission.resolved');
    expect(resolved).toMatchObject({ decision: 'allow', rule: 'git push origin feature/*' });
    // In another chat: the same kind of push goes ahead; a different one still asks.
    const again = await chat(
      ['git push origin feature/signup', 'git push origin fix/typo'],
      undefined,
      {
        read: web,
      },
    );
    expect(again.outcomes).toEqual(['ran', 'declined']);
    expect(again.asked.map((a) => a.rule)).toEqual(['git push origin fix/*']);
  });

  it('offers no "always" for a step serious enough to ask before reading (ADR 0100)', async () => {
    const { chat, rules } = await setup();
    for (const command of [DEV, 'git push --force origin main']) {
      const { asked, outcomes } = await chat([command], { decision: 'allow', rule: true });
      expect(asked).toHaveLength(1);
      expect(asked[0]?.rule).toBeUndefined();
      expect(outcomes).toEqual(['ran']);
    }
    expect(await rules()).toEqual([]);
  });

  it('keeps nothing from any answer but the press', async () => {
    for (const answer of [
      { decision: 'allow' },
      { decision: 'allow-always' },
      { decision: 'deny', rule: true },
    ] as Answer[]) {
      const { chat, rules } = await setup();
      const { outcomes } = await chat([DEV], answer);
      expect(outcomes).toEqual([answer.decision === 'deny' ? 'declined' : 'ran']);
      expect(await rules()).toEqual([]);
    }
  });

  it('offers nothing for more than one command, and a press there is only an Allow', async () => {
    const { chat, rules } = await setup();
    const { asked, outcomes } = await chat([`${DEV} && terraform output`], {
      decision: 'allow',
      rule: true,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.rule).toBeUndefined();
    expect(outcomes).toEqual(['ran']);
    expect(await rules()).toEqual([]);
  });

  it('never lifts a step no words lift, or one with someone else’s words in the chat', async () => {
    const push: AutoRule = {
      tool: 'Bash',
      prefix: ['git', 'push', 'origin', 'feature/*'],
      createdAt: 1,
    };
    const dev: AutoRule = { tool: 'Bash', prefix: DEV.split(' '), createdAt: 1 };
    // The circuit breaker: a rule Conch would never make is never used.
    const wipe: AutoRule = { tool: 'Bash', prefix: ['rm', '-rf', '/'], createdAt: 1 };
    const { chat } = await setup([push, dev, wipe]);
    const critical = await chat(['rm -rf /']);
    expect(critical.outcomes).toEqual(['declined']);
    expect(critical.asked).toHaveLength(1);
    expect(critical.asked[0]?.rule).toBeUndefined();
    // Someone else's words in the chat: asked, every time, and no rule offered.
    const theirs = await chat(['git push origin feature/login'], undefined, {
      read: { kind: 'person', label: 'Ana on Telegram' },
    });
    expect(theirs.outcomes).toEqual(['declined']);
    expect(theirs.asked).toHaveLength(1);
    expect(theirs.asked[0]?.rule).toBeUndefined();
    // Held: "don't" stands over a rule.
    const held = await chat([DEV], undefined, { text: 'Don’t apply the terraform yet' });
    expect(held.outcomes).toEqual(['declined']);
    expect(held.asked.every((a) => a.rule === undefined)).toBe(true);
  });

  it('covers a pushed branch by its kind, after reading too, and nothing added to it', async () => {
    const { chat } = await setup([
      { tool: 'Bash', prefix: ['git', 'push', 'origin', 'feature/*'], createdAt: 1 },
    ]);
    const web: TaintSource = { kind: 'web', label: 'evil.example' };
    const pushed = await chat(
      ['git push origin feature/login', 'git push origin feature/login main'],
      undefined,
      { read: web },
    );
    expect(pushed.outcomes).toEqual(['ran', 'declined']);
    expect(pushed.asked).toHaveLength(1);
  });
});

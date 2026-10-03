import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  ConversationEvent,
  EngineStatus,
  ModelInfo,
  ReplySuggestion,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { pickReplies, replyText, waitingOnYou } from './turn';

const TABLE = ['| Month | Sales |', '| --- | --- |', '| May | 120 |', '| June | 180 |'].join('\n');

let seq = 0;
const ev = (event: Record<string, unknown>): ConversationEvent =>
  ({ conversationId: 'c1', seq: seq++, at: 0, ...event }) as ConversationEvent;
const said = (text: string, messageId = 'm1') =>
  ev({ type: 'assistant.delta', messageId, kind: 'text', delta: text });

const mine: ReplySuggestion[] = [{ text: 'Make it shorter' }];
const base = {
  outcome: 'success' as const,
  unattended: false,
  tainted: false,
  tools: true,
};

describe('which replies a turn ends with', () => {
  it('the assistant’s, when it offered some', () => {
    expect(pickReplies({ ...base, assistant: mine, turn: [said(TABLE)] })).toEqual({
      replies: mine,
      by: 'assistant',
    });
  });

  it('else Conch’s own, when a rule fits the reply', () => {
    expect(pickReplies({ ...base, turn: [said(TABLE)] })).toEqual({
      replies: [{ text: 'Show it as a chart' }],
      by: 'conch',
    });
  });

  it('only Conch’s once the chat has read something untrusted', () => {
    expect(pickReplies({ ...base, tainted: true, assistant: mine, turn: [said(TABLE)] })).toEqual({
      replies: [{ text: 'Show it as a chart' }],
      by: 'conch',
    });
    expect(pickReplies({ ...base, tainted: true, assistant: mine, turn: [said('Done.')] })).toBe(
      undefined,
    );
  });

  it('nothing when nothing fits, or the assistant took back what it offered', () => {
    expect(pickReplies({ ...base, turn: [said('Done.')] })).toBeUndefined();
    expect(pickReplies({ ...base, assistant: [], turn: [said('Done.')] })).toBeUndefined();
  });

  it('nothing for nobody, or after a turn that didn’t finish', () => {
    expect(pickReplies({ ...base, unattended: true, assistant: mine, turn: [] })).toBeUndefined();
    expect(
      pickReplies({ ...base, outcome: 'interrupted', assistant: mine, turn: [said(TABLE)] }),
    ).toBeUndefined();
    expect(pickReplies({ ...base, outcome: 'error', turn: [said(TABLE)] })).toBeUndefined();
  });

  it('nothing while something else waits for the person', () => {
    const offer = ev({
      type: 'offer',
      offer: {
        offerId: 'o1',
        kind: 'app',
        target: 'linear',
        name: 'Linear',
        description: 'Issues.',
        by: 'assistant',
      },
    });
    expect(pickReplies({ ...base, assistant: mine, turn: [offer, said(TABLE)] })).toBeUndefined();
    // Once it's settled, it isn't waiting any more.
    expect(
      pickReplies({
        ...base,
        assistant: mine,
        turn: [offer, ev({ type: 'offer.resolved', offerId: 'o1', outcome: 'dismissed' })],
      }),
    ).toEqual({ replies: mine, by: 'assistant' });
  });

  it('a chart for a model that can only chat would be a promise it can’t keep', () => {
    expect(pickReplies({ ...base, tools: false, turn: [said(TABLE)] })).toBeUndefined();
  });

  it('reads the whole reply, every message of the turn', () => {
    const turn = [said('Here you go:', 'm1'), said('\n\n', 'm1'), said(TABLE, 'm2')];
    expect(replyText(turn)).toBe(`Here you go:\n\n\n\n${TABLE}`);
    expect(pickReplies({ ...base, turn })?.by).toBe('conch');
  });
});

describe('what waits for the person', () => {
  it.each([
    ['an open question', [ev({ type: 'question', question: { questionId: 'q1', fields: [] } })]],
    [
      'an approval',
      [
        ev({
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          input: {},
          summary: 'run',
        }),
      ],
    ],
    [
      'an offer to connect an app',
      [
        ev({
          type: 'integration.suggestion',
          catalogId: 'linear',
          name: 'Linear',
          description: '',
        }),
      ],
    ],
    [
      'a routine to turn on',
      [ev({ type: 'routine', routineId: 'r1', action: 'proposed', title: 'Morning' })],
    ],
    [
      'an app to fix',
      [
        ev({
          type: 'integration.issue',
          integrationId: 'i1',
          name: 'Linear',
          state: 'needs-auth',
          message: 'Sign in again.',
        }),
      ],
    ],
    [
      'the browser handed over',
      [ev({ type: 'browser.handoff', handoff: { handoffId: 'h1', state: 'waiting' } })],
    ],
    ['a message waiting for the internet', [ev({ type: 'turn.held', reason: 'offline' })]],
  ])('%s', (_, turn) => expect(waitingOnYou(turn)).toBe(true));

  it.each([
    [
      'an answered question',
      [
        ev({ type: 'question', question: { questionId: 'q1', fields: [] } }),
        ev({ type: 'question.answered', questionId: 'q1', answer: null }),
      ],
    ],
    [
      'an approval given',
      [
        ev({
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          input: {},
          summary: 'run',
        }),
        ev({ type: 'permission.resolved', permissionId: 'p1', decision: 'allow' }),
      ],
    ],
    [
      'the browser handed back',
      [
        ev({ type: 'browser.handoff', handoff: { handoffId: 'h1', state: 'waiting' } }),
        ev({ type: 'browser.handoff', handoff: { handoffId: 'h1', state: 'done' } }),
      ],
    ],
    [
      'a routine changed, not drafted',
      [ev({ type: 'routine', routineId: 'r1', action: 'updated', title: 'Morning' })],
    ],
  ])('not %s', (_, turn) => expect(waitingOnYou(turn)).toBe(false));
});

// ── Through the conversation manager ────────────────────────────────────────

const model = (id: string, tools?: boolean): ModelInfo => ({
  id,
  label: id,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
  ...(tools !== undefined && { tools }),
});

interface Script {
  reply: string;
  replies?: string[];
  /** Read a web page first: the chat is untrusted from here on. */
  read?: boolean;
  /** Ends without finishing (as Stop does). */
  outcome?: 'success' | 'interrupted' | 'error';
}

/** Says what it's told, reads a page when asked, and offers replies with Conch's tool. */
class ScriptedEngine implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  script: Script = { reply: 'Hello.' };

  constructor(
    readonly hostTools?: boolean,
    readonly models: ModelInfo[] = [model('default')],
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
      tools: { host: this.hostTools !== false, files: true, shell: false, approvals: true },
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    const { reply, replies, read, outcome = 'success' } = this.script;
    if (read) {
      yield {
        type: 'tool-start',
        toolUseId: 't1',
        name: 'WebFetch',
        input: { url: 'https://example.com' },
      };
      yield { type: 'tool-end', toolUseId: 't1', status: 'success', output: 'A page.' };
    }
    yield { type: 'text', messageId: 'm1', delta: reply };
    yield { type: 'message-done', messageId: 'm1' };
    const tool = input.tools.find((t) => t.name === 'suggest_replies');
    if (replies && tool) await tool.run({ replies: replies.map((text) => ({ text })) });
    yield { type: 'done', outcome };
  }
}

async function setup(engine = new ScriptedEngine()) {
  const home = await mkdtemp(join(tmpdir(), 'conch-replies-'));
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  const store = new ConversationStore(join(home, 'conversations'));
  const make = () =>
    new ConversationManager({
      store,
      settings,
      memory: new MemoryStore(join(home, 'memory')),
      engine: () => engine,
    });
  return { manager: make(), make, engine };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 2000; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

const repliesIn = async (manager: ConversationManager, id: string) =>
  (await manager.detail(id)).events.filter((e) => e.type === 'replies');

describe('replies to send next, in a chat', () => {
  it('ends a finished reply with the assistant’s last offer, after the turn closes', async () => {
    const { manager, engine } = await setup();
    engine.script = {
      reply: 'Here’s the invite.',
      replies: ['Add Ada to the invite', 'Make it shorter'],
    };
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Draft an invite' });
    await idle(manager, convo.id);
    const events = (await manager.detail(convo.id)).events;
    const at = events.findIndex((e) => e.type === 'replies');
    expect(events[at]).toMatchObject({
      replies: [{ text: 'Add Ada to the invite' }, { text: 'Make it shorter' }],
      by: 'assistant',
    });
    expect(events[at - 1]?.type).toBe('turn.completed');
    // The tool is Conch's: it shows as chips, never as a tool call.
    expect(events.some((e) => e.type === 'tool.started')).toBe(false);
  });

  it('gives Conch’s own chip under a table when the assistant offers none', async () => {
    const { manager, engine } = await setup();
    engine.script = { reply: TABLE };
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Sales by month?' });
    await idle(manager, convo.id);
    expect(await repliesIn(manager, convo.id)).toMatchObject([
      { replies: [{ text: 'Show it as a chart' }], by: 'conch' },
    ]);
  });

  it('shows none of the assistant’s once the chat read a page, but still Conch’s', async () => {
    const { manager, engine } = await setup();
    engine.script = { reply: 'Summarised.', replies: ['Send it to Sam'], read: true };
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Read example.com' });
    await idle(manager, convo.id);
    expect(await repliesIn(manager, convo.id)).toEqual([]);

    // Later turns in the same chat are still wary: what it read is still in it.
    engine.script = { reply: TABLE, replies: ['Send it to Sam'] };
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'As a table' });
    await idle(manager, convo.id);
    expect(await repliesIn(manager, convo.id)).toMatchObject([{ by: 'conch' }]);
  });

  it('shows nothing after Stop or a failure', async () => {
    const { manager, engine } = await setup();
    engine.script = { reply: TABLE, replies: ['Make it shorter'], outcome: 'interrupted' };
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Go' });
    await idle(manager, convo.id);
    engine.script = { reply: TABLE, replies: ['Make it shorter'], outcome: 'error' };
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'Again' });
    await idle(manager, convo.id);
    expect(await repliesIn(manager, convo.id)).toEqual([]);
  });

  it('offers no tool and shows nothing in an unattended run', async () => {
    const { manager, engine } = await setup();
    engine.script = { reply: TABLE, replies: ['Make it shorter'] };
    const run = await manager.start({
      title: 'Morning',
      text: 'Brief me',
      origin: { kind: 'routine', routineId: 'r1', runId: 'run1' },
      extras: {},
    });
    await run.result;
    expect(engine.turns[0]?.tools.some((t) => t.name === 'suggest_replies')).toBe(false);
    expect(await repliesIn(manager, run.conversationId)).toEqual([]);
  });

  it('shows nothing in a chat that came from a chat app', async () => {
    const { manager, engine } = await setup();
    engine.script = { reply: TABLE, replies: ['Make it shorter'] };
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'Sales?',
      origin: { kind: 'channel', channelId: 'ch1', channel: 'telegram' },
    });
    await idle(manager, convo.id);
    expect(engine.turns[0]?.tools.some((t) => t.name === 'suggest_replies')).toBe(false);
    expect(await repliesIn(manager, convo.id)).toEqual([]);
  });

  it('gives a chat-only provider no tool, and only what it could do', async () => {
    const { manager, engine } = await setup(new ScriptedEngine(false));
    engine.script = { reply: TABLE };
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Sales?' });
    await idle(manager, convo.id);
    expect(engine.turns[0]?.tools.some((t) => t.name === 'suggest_replies')).toBe(false);
    // A chart needs Conch's tools: not offered to a model that can't make one.
    expect(await repliesIn(manager, convo.id)).toEqual([]);
  });

  it('reads the chat-only model, not just its provider', async () => {
    const { manager, engine } = await setup(
      new ScriptedEngine(true, [model('default'), model('tiny', false)]),
    );
    engine.script = { reply: TABLE };
    const convo = await manager.send({
      clientMessageId: 'u1',
      text: 'Sales?',
      options: { engine: 'openrouter', model: 'tiny' },
    });
    await idle(manager, convo.id);
    expect(await repliesIn(manager, convo.id)).toEqual([]);
  });

  it('keeps the chips through a restart: they’re in the chat’s log', async () => {
    const { manager, make, engine } = await setup();
    engine.script = { reply: 'Done.', replies: ['Make it shorter'] };
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Write it' });
    await idle(manager, convo.id);
    // The log is written just after the chat says it's idle: give the write a moment.
    let after: ConversationEvent[] = [];
    for (let i = 0; i < 200 && !after.length; i++) {
      after = await repliesIn(make(), convo.id);
      if (!after.length) await new Promise((r) => setTimeout(r, 10));
    }
    expect(after).toMatchObject([{ replies: [{ text: 'Make it shorter' }], by: 'assistant' }]);
  });
});

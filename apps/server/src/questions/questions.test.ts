import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { ConversationManager, type ToolContext } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import { hostToolText, type Engine, type EngineEvent, type TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { NOBODY, ONE_AT_A_TIME, QuestionDesk, QuestionError, SKIPPED } from './desk';
import { questionTools } from './tools';

const QUESTION = {
  title: 'Your call with Ada',
  fields: [
    {
      id: 'when',
      label: 'When suits you?',
      kind: 'datetime',
      min: '2026-10-05',
      max: '2026-10-16',
      suggested: '2026-10-09T10:00',
    },
    {
      id: 'how',
      label: 'How would you like to talk?',
      kind: 'choice',
      options: [
        { id: 'video', label: 'Video call' },
        { id: 'phone', label: 'Phone call' },
      ],
    },
  ],
};

/** Asks with `ask` when told to, then says what it was told back. */
class AskingEngine implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly integrations = { mode: 'bridge' as const };
  readonly told: string[] = [];
  readonly turns: TurnInput[] = [];

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
      permissionModes: ['default'],
      tools: { host: true, files: true, shell: false, approvals: true },
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    const ask = input.tools.find((t) => t.name === 'ask');
    if (/book/.test(input.prompt) && ask) {
      yield { type: 'tool-start', toolUseId: 't1', name: 'mcp__conch__ask', input: QUESTION };
      const said = hostToolText(await ask.run(QUESTION as never));
      this.told.push(said);
      yield { type: 'tool-end', toolUseId: 't1', status: 'success', output: said };
      if (input.signal.aborted) {
        yield { type: 'done', outcome: 'interrupted' };
        return;
      }
    }
    yield { type: 'text', messageId: `m${this.turns.length}`, delta: 'Done.' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-questions-'));
  const engine = new AskingEngine();
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { autoTitle: false } });
  const questions = new QuestionDesk();
  const store = new ConversationStore(join(home, 'conversations'));
  const make = () =>
    new ConversationManager({
      store,
      settings,
      memory: new MemoryStore(join(home, 'memory')),
      engine: () => engine,
      tools: (ctx) => questionTools(questions, ctx),
      questions,
    });
  return { manager: make(), make, engine, questions, store };
}

async function until<T>(look: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 2000; i++) {
    const found = await look();
    if (found !== undefined) return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

const log = async (manager: ConversationManager, id: string): Promise<ConversationEvent[]> =>
  (await manager.detail(id)).events;

async function asked(manager: ConversationManager) {
  const { id } = await manager.send({ clientMessageId: 'u1', text: 'book a call with Ada' });
  const question = await until(async () => {
    const event = (await log(manager, id)).find((e) => e.type === 'question');
    return event?.type === 'question' ? event.question : undefined;
  });
  return { id, question };
}

const finished = (manager: ConversationManager, id: string) =>
  until(async () => {
    const { conversation } = await manager.detail(id);
    return conversation.status === 'idle' || conversation.status === 'error' ? true : undefined;
  });

describe('ask: questions answered with a tap (ADR 0055)', () => {
  it('shows the question, waits for you, and hands the answer on in words the chat shows', async () => {
    const { manager, engine, questions } = await setup();
    const { id, question } = await asked(manager);
    expect(question.title).toBe('Your call with Ada');
    expect((await manager.detail(id)).conversation.status).toBe('awaiting-permission');
    expect(manager.busy()).toBe(true);
    // Invented words are written over: the log says what was really chosen.
    questions.answer(id, question.questionId, {
      values: { when: '2026-10-09T10:00', how: 'video' },
      text: 'Whatever the client says',
    });
    await finished(manager, id);
    const events = await log(manager, id);
    const answered = events.find((e) => e.type === 'question.answered');
    expect(answered).toMatchObject({
      answer: { text: 'Friday 9 Oct, 10:00 · Video call' },
    });
    expect(engine.told[0]).toContain('They answered: Friday 9 Oct, 10:00 · Video call');
    expect(engine.told[0]).toContain('"how":"video"');
    // The chat went back to running once answered, then finished.
    const statuses = events.flatMap((e) => (e.type === 'status' ? [e.status] : []));
    expect(statuses).toEqual(['running', 'awaiting-permission', 'running', 'idle']);
  });

  it('refuses an answer that doesn’t fit, and keeps waiting', async () => {
    const { manager, questions } = await setup();
    const { id, question } = await asked(manager);
    const answer = (values: Record<string, unknown>) => () =>
      questions.answer(id, question.questionId, { values: values as never, text: 'x' });
    expect(answer({ when: '2026-10-09T10:00', how: ['video', 'phone'] })).toThrow(QuestionError);
    expect(answer({ when: '2026-11-01T10:00', how: 'video' })).toThrow(/too late/);
    expect(answer({ how: 'video' })).toThrow(/needs an answer/);
    expect(() => questions.answer(id, 'q_nope', null)).toThrow(/isn’t waiting/);
    expect(questions.waiting(id)?.questionId).toBe(question.questionId);
    questions.answer(id, question.questionId, null);
    await finished(manager, id);
    // A second device pressing late is told it's done.
    expect(() => questions.answer(id, question.questionId, null)).toThrow(
      expect.objectContaining({ code: 'answered' }),
    );
  });

  it('skipping tells the assistant to carry on with its best judgement', async () => {
    const { manager, engine, questions } = await setup();
    const { id, question } = await asked(manager);
    questions.answer(id, question.questionId, null);
    await finished(manager, id);
    expect(engine.told[0]).toBe(SKIPPED);
    expect((await log(manager, id)).find((e) => e.type === 'question.answered')).toMatchObject({
      answer: null,
    });
  });

  it('answers with what you type while it waits, as your message', async () => {
    const { manager, engine } = await setup();
    const { id } = await asked(manager);
    await manager.send({
      conversationId: id,
      clientMessageId: 'u2',
      text: 'Thursday afternoon, by phone',
    });
    await finished(manager, id);
    const events = await log(manager, id);
    const said = events.filter((e) => e.type === 'user.message');
    expect(said.map((e) => (e.type === 'user.message' ? e.text : ''))).toEqual([
      'book a call with Ada',
      'Thursday afternoon, by phone',
    ]);
    const answered = events.find((e) => e.type === 'question.answered');
    expect(answered).toMatchObject({
      answer: { values: {}, text: 'Thursday afternoon, by phone' },
    });
    // The message comes first, then the card folds: the chat reads as it happened.
    expect(answered?.seq).toBeGreaterThan(said[1]?.seq ?? Infinity);
    expect(engine.told[0]).toContain('their own words: “Thursday afternoon, by phone”');
    // Only one turn ran: the typed answer didn't start another.
    expect(engine.turns).toHaveLength(1);
  });

  it('won’t take files as an answer', async () => {
    const { manager } = await setup();
    const { id } = await asked(manager);
    await expect(
      manager.send({ conversationId: id, clientMessageId: 'u2', text: 'here', attachments: ['a'] }),
    ).rejects.toThrow(/Answer the question first/);
  });

  it('stopping the reply answers it with nothing', async () => {
    const { manager, engine } = await setup();
    const { id, question } = await asked(manager);
    await manager.interrupt(id);
    await finished(manager, id);
    const events = await log(manager, id);
    const answered = events.findIndex((e) => e.type === 'question.answered');
    const ended = events.findIndex((e) => e.type === 'turn.completed');
    expect(events[answered]).toMatchObject({ questionId: question.questionId, answer: null });
    expect(answered).toBeLessThan(ended);
    expect(engine.told[0]).toBe(SKIPPED);
  });

  it('after a restart, a question that was waiting reads as skipped', async () => {
    const { manager, make, store } = await setup();
    const { id, question } = await asked(manager);
    // The question was saved as it was asked; the process "dies" here.
    await until(async () =>
      (await store.events(id)).some((e) => e.type === 'question') ? true : undefined,
    );
    const again = make();
    const events = await log(again, id);
    expect(events.at(-1)).toMatchObject({
      type: 'question.answered',
      questionId: question.questionId,
      answer: null,
    });
    await manager.interrupt(id);
  });
});

describe('nobody to ask', () => {
  const ctx = (unattended: boolean): ToolContext => ({
    conversationId: 'c1',
    append: () => {},
    engine: new AskingEngine(),
    permissionMode: 'default',
    ask: async () => 'deny',
    signal: new AbortController().signal,
    unattended,
  });

  it('a routine, a task or a chat app’s chat gets no `ask`', () => {
    const desk = new QuestionDesk();
    expect(questionTools(desk, ctx(true))).toEqual([]);
    expect(questionTools(desk, ctx(false)).map((t) => t.name)).toEqual(['ask']);
  });

  it('and if asked anyway, it’s told to choose the sensible default', async () => {
    const desk = new QuestionDesk();
    await expect(desk.ask(ctx(true), { fields: [] })).resolves.toBe(NOBODY);
  });

  it('one question at a time', async () => {
    const desk = new QuestionDesk();
    const appended: string[] = [];
    const c = { ...ctx(false), append: (e: { type: string }) => appended.push(e.type) };
    const first = desk.ask(c, QUESTION as never);
    await expect(desk.ask(c, QUESTION as never)).resolves.toBe(ONE_AT_A_TIME);
    expect(appended).toEqual(['question']);
    desk.close('c1');
    await expect(first).resolves.toBe(SKIPPED);
  });

  it('a question that can’t be drawn says why, so the assistant can fix it', async () => {
    const [ask] = questionTools(new QuestionDesk(), ctx(false));
    const out = await ask?.run({
      fields: [
        { id: 'a', label: 'A?', kind: 'text' },
        { id: 'a', label: 'B?', kind: 'text' },
      ],
    } as never);
    expect(out).toMatch(/each field needs its own `id`/);
    const bad = await ask?.run({
      fields: [{ id: 'a', label: 'A?', kind: 'choice', options: [{ id: 'x', label: 'X' }] }],
    } as never);
    expect(bad).toMatch(/couldn’t be shown/);
  });
});

import type {
  ActivityFamily,
  ConversationEvent,
  ServerEvent,
  Story,
  StoryStep,
  ToolLabel,
} from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Completion, CompletionInput, Engine } from '../../engines/types';
import { smallModelEngine, type NotAsked } from './ask';
import { StoryTitler, storyKey, wantsHeadline, type StoryTitlerDeps } from './titler';

/** Consecutive steps of one family are a story; its headline counts its steps. */
function tell(steps: StoryStep[], headline = (n: number) => `Used ${n} tools`): Story[] {
  const stories: Story[] = [];
  for (const step of steps) {
    const last = stories.at(-1);
    if (last && last.family === step.label.family) last.steps.push(step);
    else
      stories.push({
        id: step.id,
        family: step.label.family,
        steps: [step],
        status: 'done',
        headline: '',
        chips: [],
        effects: [],
        repeats: 0,
        startedAt: step.startedAt,
      });
  }
  for (const story of stories) {
    story.status = story.steps.some((s) => s.status === 'running' || s.status === 'pending')
      ? 'running'
      : story.steps.some((s) => s.status === 'error')
        ? 'failed'
        : 'done';
    story.headline = headline(story.steps.length);
  }
  return stories;
}

const fakeEngine = (id: string, extra: Partial<Engine> = {}) =>
  ({ id, label: id, ...extra }) as unknown as Engine;

function harness(
  overrides: Partial<StoryTitlerDeps> = {},
  reply: (input: CompletionInput) => Promise<Completion> = async () => ({
    text: '{"headline":"Found why the login test fails","outcome":"1 test fails"}',
    usage: { inputTokens: 200, outputTokens: 12 },
  }),
) {
  const engine = fakeEngine('anthropic');
  const complete = vi.fn(reply);
  const notes: { id: string; storyId: string; headline: string; outcome?: string }[] = [];
  const spent = vi.fn();
  const titler = new StoryTitler({
    model: async () => ({ engine, complete, model: 'small' }),
    allow: async () => ({ ok: true }),
    spent,
    enabled: async () => true,
    note: async (id, event) => {
      notes.push({
        id,
        storyId: event.storyId,
        headline: event.headline,
        ...(event.outcome && { outcome: event.outcome }),
      });
    },
    tell: (steps) => tell(steps),
    ...overrides,
  });
  let seq = 0;
  const emit = (event: Record<string, unknown>, conversationId = 'c1') =>
    titler.onEvent({
      type: 'conversation.event',
      event: { conversationId, seq: seq++, at: 1_000 + seq, ...event } as ConversationEvent,
    } as ServerEvent);
  const step = (
    id: string,
    family: ActivityFamily = 'explore',
    finish: 'success' | 'error' | false = 'success',
    conversationId = 'c1',
  ) => {
    const label: ToolLabel = { family, doing: `Doing ${id}`, done: `Did ${id}` };
    emit(
      { type: 'tool.started', toolUseId: id, name: 'Read', input: { id }, label },
      conversationId,
    );
    if (finish)
      emit(
        {
          type: 'tool.finished',
          toolUseId: id,
          status: finish,
          output: `output of ${id}`,
          label: { ...label, outcome: finish === 'error' ? 'failed' : 'ok' },
        },
        conversationId,
      );
  };
  const asked = (text = 'Why does login fail?', conversationId = 'c1') =>
    emit({ type: 'user.message', messageId: `u${seq}`, text }, conversationId);
  const end = (conversationId = 'c1') =>
    emit({ type: 'turn.completed', outcome: 'success' }, conversationId);
  return { titler, complete, notes, spent, emit, step, asked, end, engine };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('story headlines by a small model (ADR 0103)', () => {
  it('titles a story of three steps when the turn ends, and counts what it cost', async () => {
    const h = harness();
    h.asked();
    h.step('t1');
    h.step('t2');
    h.step('t3');
    expect(h.complete).not.toHaveBeenCalled();
    h.end();
    await vi.waitFor(() => expect(h.notes).toHaveLength(1));
    expect(h.notes[0]).toEqual({
      id: 'c1',
      storyId: 't1',
      headline: 'Found why the login test fails',
      outcome: '1 test fails',
    });
    expect(h.spent).toHaveBeenCalledWith({ inputTokens: 200, outputTokens: 12 }, h.engine, 'small');
    const input = h.complete.mock.calls[0]?.[0];
    expect(input?.model).toBe('small');
    expect(input?.prompt).toContain('<request>Why does login fail?</request>');
    expect(input?.prompt).toContain('Did t3 | outcome: ok');
    expect(input?.prompt).toContain('output of t2');
  });

  it('titles a story once the assistant’s words interrupt it, or it’s no longer the last', async () => {
    const h = harness();
    h.asked();
    h.step('a1');
    h.step('a2');
    h.step('a3');
    h.emit({ type: 'assistant.delta', messageId: 'm1', kind: 'thinking', delta: 'hmm' });
    expect(h.complete).not.toHaveBeenCalled();
    h.emit({ type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Found it. ' });
    await vi.waitFor(() => expect(h.notes.map((n) => n.storyId)).toEqual(['a1']));

    h.step('b1', 'edit');
    h.step('b2', 'edit');
    h.step('b3', 'edit');
    h.step('c1', 'verify', false);
    await vi.waitFor(() => expect(h.notes.map((n) => n.storyId)).toEqual(['a1', 'b1']));
  });

  it('leaves short stories and ones the rules already say well to the rules', async () => {
    const h = harness({ tell: (steps) => tell(steps, (n) => `Read ${n} files`) });
    h.asked();
    h.step('s1');
    h.step('s2');
    h.step('s3');
    h.end();
    await settle();
    expect(h.complete).not.toHaveBeenCalled();

    const two = harness();
    two.asked();
    two.step('x1');
    two.step('x2');
    two.end();
    await settle();
    expect(two.complete).not.toHaveBeenCalled();
  });

  it('titles two steps of different kinds told as one story', async () => {
    const h = harness({
      tell: (steps) => {
        const [first] = tell(steps);
        return first ? [{ ...first, steps, family: 'explore', headline: 'Looked into it' }] : [];
      },
    });
    h.asked();
    h.step('m1', 'explore');
    h.step('m2', 'edit');
    h.end();
    await vi.waitFor(() => expect(h.notes).toHaveLength(1));
  });

  it.each([
    ['not JSON', 'Found the bug'],
    ['an echo of a step', '{"headline":"Did t2"}'],
    ['in the first person', '{"headline":"I found the bug"}'],
    ['marked up', '{"headline":"Found the **bug**"}'],
  ])('drops a reply that is %s', async (_why, text) => {
    const h = harness({}, async () => ({ text }));
    h.asked();
    h.step('t1');
    h.step('t2');
    h.step('t3');
    h.end();
    await vi.waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
    await settle();
    expect(h.notes).toEqual([]);
  });

  it('gives up after its time, and a provider that fails costs nothing', async () => {
    const h = harness(
      { timeoutMs: 20 },
      (input) =>
        new Promise((_resolve, reject) =>
          input.signal.addEventListener('abort', () => reject(new Error('timed out'))),
        ),
    );
    h.asked();
    h.step('t1');
    h.step('t2');
    h.step('t3');
    h.end();
    await vi.waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.notes).toEqual([]);
    expect(h.spent).not.toHaveBeenCalled();
  });

  it('asks about the same steps once: the next time, the headline is remembered', async () => {
    const h = harness();
    for (const chat of ['c1', 'c2']) {
      h.asked('Why does login fail?', chat);
      h.step('t1', 'explore', 'success', chat);
      h.step('t2', 'explore', 'success', chat);
      h.step('t3', 'explore', 'success', chat);
      h.end(chat);
      await vi.waitFor(() => expect(h.notes.filter((n) => n.id === chat)).toHaveLength(1));
    }
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it.each<[NotAsked]>([['cap'], ['budget'], ['plan-room']])(
    'asks nothing when the spend rules say no (%s)',
    async (reason) => {
      const h = harness({ allow: async () => ({ ok: false, reason }) });
      h.asked();
      h.step('t1');
      h.step('t2');
      h.step('t3');
      h.end();
      await settle();
      await settle();
      expect(h.complete).not.toHaveBeenCalled();
      expect(h.notes).toEqual([]);
    },
  );

  it('asks nothing when it’s turned off, no provider can answer, or nobody watches the chat', async () => {
    for (const overrides of [
      { enabled: async () => false },
      { model: async () => undefined },
      { watched: async () => false },
    ] satisfies Partial<StoryTitlerDeps>[]) {
      const h = harness(overrides);
      h.asked();
      h.step('t1');
      h.step('t2');
      h.step('t3');
      h.end();
      await settle();
      await settle();
      expect(h.complete).not.toHaveBeenCalled();
      expect(h.notes).toEqual([]);
    }
  });

  it('titles a few stories a turn at most, two at a time', async () => {
    let running = 0;
    let most = 0;
    const h = harness({ perTurn: 3 }, async (input) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      const n = /\d+\. \[\w+\] Did (\w+)/.exec(input.prompt)?.[1] ?? 'x';
      return { text: JSON.stringify({ headline: `Worked through part ${n}` }) };
    });
    h.asked();
    const families: ActivityFamily[] = ['explore', 'edit', 'verify', 'research', 'browse'];
    for (const [i, family] of families.entries())
      for (const j of [1, 2, 3]) h.step(`s${i}${j}`, family);
    h.end();
    await vi.waitFor(() => expect(h.notes).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.complete).toHaveBeenCalledTimes(3);
    expect(most).toBeLessThanOrEqual(2);
  });

  it('follows a chat logged before labels: the rules work them out', async () => {
    const h = harness();
    h.asked();
    for (const id of ['o1', 'o2', 'o3']) {
      h.emit({ type: 'tool.started', toolUseId: id, name: 'Bash', input: { command: 'ls' } });
      h.emit({ type: 'tool.finished', toolUseId: id, status: 'success', output: 'a b' });
    }
    h.end();
    await vi.waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
  });

  it('never lets a broken story-teller disturb the chat', () => {
    const h = harness({
      tell: () => {
        throw new Error('bad');
      },
    });
    h.asked();
    expect(() => h.step('t1')).not.toThrow();
    expect(() => h.end()).not.toThrow();
  });

  it('keys a story by its steps’ words, and wants a headline only when it has ended', () => {
    const [story] = tell([
      {
        id: 'k1',
        name: 'Read',
        input: {},
        status: 'success',
        label: { family: 'explore', doing: 'Reading', done: 'Read' },
        startedAt: 0,
      },
    ]);
    if (!story) throw new Error('no story');
    expect(storyKey(story)).toBe(storyKey({ ...story, id: 'other' }));
    expect(wantsHeadline({ ...story, status: 'running' })).toBe(false);
  });
});

describe('who writes the headline', () => {
  const answering = fakeEngine('codex-cli');
  const local = fakeEngine('ollama', { local: true, complete: vi.fn() });
  const other = fakeEngine('anthropic', { complete: vi.fn() });

  it('is the provider that answered, when it can write one', () => {
    const able = fakeEngine('claude-code', { complete: vi.fn() });
    expect(smallModelEngine(able, [other, able], { private: false })).toBe(able);
  });

  it('is one on this computer, else any other, when the one that answered can’t', () => {
    expect(smallModelEngine(answering, [answering, other, local], { private: false })).toBe(local);
    expect(smallModelEngine(answering, [answering, other], { private: false })).toBe(other);
  });

  it('is never another provider for a private chat, only one on this computer', () => {
    expect(smallModelEngine(answering, [answering, other], { private: true })).toBeUndefined();
    expect(smallModelEngine(answering, [answering, other, local], { private: true })).toBe(local);
  });
});

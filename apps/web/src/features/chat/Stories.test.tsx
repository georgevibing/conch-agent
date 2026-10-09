/**
 * The chat tells what the assistant is doing (ADR 0103): runs of tool calls
 * as stories, the provider's own words while one runs, headlines that come
 * later, what a turn changed with Undo, Why?, and what happened while away.
 */
import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { reduceAll, type ConversationView } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from './Transcript';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ undoing: undefined });
});

let seq = 0;
function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e) =>
      ({ ...e, conversationId: 'c1', seq: seq++, at: Date.now() + seq * 100 }) as ConversationEvent,
  );
}

const asked: ConversationEventInput = {
  type: 'user.message',
  messageId: 'u1',
  text: 'Look around the project',
};
const call = (
  id: string,
  name: string,
  input: unknown,
  output = 'ok',
): ConversationEventInput[] => [
  { type: 'tool.started', toolUseId: id, name, input },
  { type: 'tool.finished', toolUseId: id, status: 'success', output, durationMs: 120 },
];
const said = (id: string, text: string): ConversationEventInput[] => [
  { type: 'assistant.delta', messageId: id, kind: 'text', delta: text },
  { type: 'assistant.done', messageId: id },
];
const done: ConversationEventInput = { type: 'turn.completed', outcome: 'success' };

const live: { show: (view: ConversationView) => void } = { show: () => {} };
const show = (view: ConversationView) => live.show(view);

function Live({ first }: { first: ConversationView }) {
  const [view, setView] = useState(first);
  useEffect(() => {
    live.show = setView;
  }, []);
  return (
    <Transcript
      view={view}
      pending={[]}
      name="Conch"
      onRespond={() => {}}
      onRetry={() => {}}
      conversationId="c1"
    />
  );
}

function open(view: ConversationView, routes: Record<string, (body: unknown) => unknown> = {}) {
  const calls = mockFetch({ 'GET /api/state': () => appState(), ...routes });
  const rendered = renderApp(<Live first={view} />);
  return { ...rendered, calls };
}

const story = (headline: RegExp) => {
  const row = screen.getByRole('button', { name: headline });
  return row.closest('[data-story]') as HTMLElement;
};

describe('a run of steps, told as stories', () => {
  it('tells an old chat’s calls in plain words, and keeps the exact call one press away', async () => {
    const user = userEvent.setup();
    open(
      reduceAll(
        log(
          asked,
          ...said('m1', 'Let me look.'),
          ...call('t1', 'Read', { file_path: '/p/src/app.ts' }),
          ...call('t2', 'Read', { file_path: '/p/src/main.ts' }),
          ...call('t3', 'Bash', { command: 'git -C /p status --short' }, ' M src/app.ts'),
          ...said('m1', 'All clear.'),
          done,
        ),
      ),
    );
    // No raw tool names: lines that say what happened.
    expect(screen.queryByText('Bash')).toBeNull();
    const row = screen.getByRole('button', { name: /^Read app\.ts and main\.ts|^Read 2 files/ });
    await user.click(row);
    const steps = within(row.closest('[data-story]') as HTMLElement).getByRole('list', {
      name: 'Steps',
    });
    expect(steps).toHaveTextContent('Read app.ts');
    // The exact call, a press further: its name, its input.
    await user.click(within(steps).getByRole('button', { name: /Read app\.ts/ }));
    expect(steps.textContent).toContain('"/p/src/app.ts"');
  });

  it('says on a command’s row where it ran, when that wasn’t this computer (ADR 0106)', async () => {
    const user = userEvent.setup();
    open(
      reduceAll(
        log(
          asked,
          { type: 'tool.started', toolUseId: 'w1', name: 'Bash', input: { command: 'npm test' } },
          {
            type: 'tool.finished',
            toolUseId: 'w1',
            status: 'success',
            output: '12 passed',
            durationMs: 900,
            where: { kind: 'ssh', name: 'build-box' },
          },
          done,
        ),
      ),
    );
    // Said on the row itself, and read out with it.
    const row = await screen.findByRole('button', { name: /ran on build-box/ });
    expect(row.querySelector('[aria-label="Ran on build-box"]')).not.toBeNull();
    await user.click(row);
  });

  it('takes a small model’s headline once it comes, after the turn', () => {
    const events = log(
      asked,
      ...call('t1', 'Read', { file_path: '/p/a.ts' }),
      ...call('t2', 'Grep', { pattern: 'TODO' }),
      ...call('t3', 'Glob', { pattern: '**/*.md' }),
      done,
    );
    open(reduceAll(events));
    act(() =>
      show(
        reduceAll([
          ...events,
          ...log({
            type: 'story.titled',
            storyId: 't1',
            headline: 'Looked around the project',
            source: 'model',
          }),
        ]),
      ),
    );
    const titled = story(/^Looked around the project/);
    expect(titled).toHaveAttribute('data-source', 'model');
  });

  it('while it runs, the live line says the provider’s own words', () => {
    open({
      ...reduceAll(
        log(
          asked,
          { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: { command: 'pnpm test' } },
          { type: 'narration', text: 'Making sure nothing else broke', source: 'provider' },
        ),
      ),
      status: 'running',
    });
    expect(screen.getAllByText('Making sure nothing else broke').length).toBeGreaterThan(0);
  });

  it('draws what a step found that’s the answer in sight, without opening anything', () => {
    open(
      reduceAll(
        log(
          asked,
          {
            type: 'tool.started',
            toolUseId: 't1',
            name: 'mcp__conch__google_mail_search',
            input: {},
          },
          {
            type: 'tool.finished',
            toolUseId: 't1',
            status: 'success',
            output: '{}',
            view: {
              kind: 'mail',
              items: [
                {
                  from: 'Ada Lovelace',
                  subject: 'Budget',
                  date: '2026-10-02T10:00:00Z',
                  unread: true,
                  attachments: false,
                },
              ],
            },
          },
          done,
        ),
      ),
    );
    expect(screen.getByRole('region', { name: 'Emails, 1 email' })).toBeInTheDocument();
  });

  it('Why? asks the gateway about that step, and shows the answer as plain words', async () => {
    const user = userEvent.setup();
    const { calls } = open(
      reduceAll(
        log(
          asked,
          ...call('t1', 'Bash', { command: 'pnpm test' }, 'Tests  241 passed (241)'),
          done,
        ),
      ),
      { 'POST /api/conversations/c1/explain': () => ({ answer: 'To check **nothing** broke.' }) },
    );
    await user.click(screen.getByRole('button', { name: /^Ran the tests/ }));
    await user.click(screen.getByRole('button', { name: 'Why?' }));
    await waitFor(() => expect(screen.getByText('**nothing**')).toBeInTheDocument());
    expect(calls.find((c) => c.path === '/api/conversations/c1/explain')?.body).toEqual({
      toolUseId: 't1',
    });
  });
});

describe('what a turn changed', () => {
  const edit = (id: string, path: string): ConversationEventInput[] => [
    ...call(id, 'Edit', { file_path: `/p/${path}`, old_string: 'a', new_string: 'b' }),
    {
      type: 'files.changed',
      changeSetId: `cs_${id}`,
      toolUseId: id,
      label: `Changed ${path}`,
      files: [{ path, kind: 'changed' }],
    },
  ];

  it('says it once at the end of the reply, with Undo for each change and for all', async () => {
    const user = userEvent.setup();
    open(
      reduceAll(
        log(
          asked,
          ...edit('t1', 'notes/a.md'),
          ...edit('t2', 'b.md'),
          ...call('t3', 'Bash', { command: 'git commit -am "Tidy"' }, '[main 1a2b3c] Tidy'),
          ...said('m1', 'Done.'),
          done,
        ),
      ),
    );
    // One story for both edits: the change sets don't break the run.
    expect(document.querySelectorAll('[data-story]').length).toBeLessThanOrEqual(2);
    const changed = screen.getByRole('region', { name: 'What changed' });
    expect(changed).toHaveTextContent('Committed “Tidy” · changed 2 files');
    // After the words.
    expect(
      screen.getByText('Done.').compareDocumentPosition(changed) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(within(changed).getByRole('button', { name: /Committed/ }));
    await user.click(within(changed).getByRole('button', { name: 'Undo all 2 changes' }));
    await waitFor(() =>
      expect(useUi.getState().undoing).toEqual({ ids: ['cs_t1', 'cs_t2'], direction: 'undo' }),
    );
  });

  it('says nothing when the turn changed nothing', () => {
    open(reduceAll(log(asked, ...call('t1', 'Read', { file_path: '/p/a.ts' }), done)));
    expect(screen.queryByRole('region', { name: 'What changed' })).toBeNull();
  });
});

describe('while you were away', () => {
  const visibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  afterEach(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }),
  );

  it('says what finished with the tab hidden, and each line goes to its story', async () => {
    const user = userEvent.setup();
    const before = log(asked, ...call('t1', 'Read', { file_path: '/p/a.ts' }));
    open({ ...reduceAll(before), status: 'running' });
    visibility('hidden');
    const after = [
      ...before,
      ...log(
        ...said('m1', 'Now the tests.'),
        ...call('t2', 'Bash', { command: 'pnpm test' }, 'Tests  241 passed (241)'),
        ...said('m1', 'And ship it.'),
        ...call('t3', 'Bash', { command: 'git push origin main' }, 'main -> main'),
        done,
      ),
    ];
    act(() => show(reduceAll(after)));
    expect(screen.queryByRole('region', { name: 'While you were away' })).toBeNull();
    visibility('visible');
    const digest = await screen.findByRole('region', { name: 'While you were away' });
    expect(digest).toHaveTextContent('Ran the tests');
    expect(digest).toHaveTextContent('Pushed to main');
    // Only what finished meanwhile: the read was done before.
    expect(digest).not.toHaveTextContent('Read a.ts');
    await user.click(within(digest).getByRole('button', { name: /Ran the tests/ }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'While you were away' })).toBeNull(),
    );
    expect(document.querySelector('[data-story="t2"]')).toHaveAttribute('data-state', 'open');
  });

  it('stays quiet when only one thing happened', () => {
    const before = log(asked);
    open({ ...reduceAll(before), status: 'running' });
    visibility('hidden');
    act(() =>
      show(reduceAll([...before, ...log(...call('t1', 'Bash', { command: 'pnpm test' }), done)])),
    );
    visibility('visible');
    expect(screen.queryByRole('region', { name: 'While you were away' })).toBeNull();
  });
});

describe('the turn’s tally', () => {
  it('a long turn says how long and how many steps, once it’s over', () => {
    const view = reduceAll(
      log(
        asked,
        ...said('m1', 'Looking.'),
        ...call('t1', 'Read', { file_path: '/p/a.ts' }),
        ...call('t2', 'Bash', { command: 'pnpm test' }),
        ...said('m1', 'Done.'),
        done,
      ),
    );
    const items = view.items.map((i) => (i.kind === 'turn-end' ? { ...i, ranMs: 64_000 } : i));
    open({ ...view, items });
    expect(
      screen.getByRole('group', { name: /^Worked, for 1m 04s, 2 steps|^Worked for/ }),
    ).toHaveAccessibleName(expect.stringContaining('2 steps') as unknown as string);
  });
});

describe('a live run, one step after another', () => {
  // Tool A starts, A ends, a gap, tool B starts, B ends, then the reply.
  const a: ConversationEventInput = {
    type: 'tool.started',
    toolUseId: 't1',
    name: 'Read',
    input: { file_path: '/p/diary.ts' },
  };
  const aDone: ConversationEventInput = {
    type: 'tool.finished',
    toolUseId: 't1',
    status: 'success',
    output: 'ok',
    durationMs: 120,
  };
  const b: ConversationEventInput = {
    type: 'tool.started',
    toolUseId: 't2',
    name: 'Read',
    input: { file_path: '/p/meals.ts' },
  };
  const bDone: ConversationEventInput = { ...aDone, toolUseId: 't2' } as ConversationEventInput;
  const reply: ConversationEventInput = {
    type: 'assistant.delta',
    messageId: 'm1',
    kind: 'text',
    delta: 'You ate well today.',
  };
  const running = (events: ConversationEvent[]): ConversationView => ({
    ...reduceAll(events),
    status: 'running',
  });
  const row = () => document.querySelector<HTMLElement>('[data-story="t1"]');
  const line = () => row()?.querySelector<HTMLElement>('.below');

  it('keeps the same row, still working, with its line beneath, from the first step to the reply', () => {
    const steps = log(asked, a, aDone, b, bDone, reply, done);
    const upTo = (n: number) => steps.slice(0, n);
    open(running(upTo(2)));
    const first = row();
    expect(first).toHaveAttribute('data-status', 'running');
    expect(line()).toHaveAttribute('data-shown');

    // A has ended and B hasn't started (and then B, and B ended): the run isn't over, so the row holds.
    for (const n of [3, 4, 5]) {
      act(() => show(running(upTo(n))));
      expect(row()).toBe(first);
      expect(row()).toHaveAttribute('data-status', 'running');
      expect(line()).toHaveAttribute('data-shown');
      // The row says the pause itself: no second wait drawn under it.
      expect(document.querySelector('.between')).toBeNull();
    }

    // The reply is here: the run is over and folds to its line.
    act(() => show(running(upTo(6))));
    expect(row()).toBe(first);
    expect(row()).toHaveAttribute('data-status', 'done');
    expect(line()).not.toHaveAttribute('data-shown');
    act(() => show(reduceAll(steps)));
    expect(row()).toBe(first);
    expect(row()).toHaveAttribute('data-status', 'done');
  });

  it('says it’s thinking between steps, or the provider’s own note when there is one', async () => {
    const steps = log(asked, a, aDone);
    open(running(steps));
    await waitFor(() => expect(line()).toHaveTextContent('Thinking…'));
    act(() =>
      show(
        running([
          ...steps,
          ...log({ type: 'narration', text: 'Checking the meals next', source: 'provider' }),
        ]),
      ),
    );
    await waitFor(() => expect(line()).toHaveTextContent('Checking the meals next'));
  });

  it('keeps the provider’s note about the run through the pause, rather than flicking to thinking', () => {
    open(
      running(
        log(
          asked,
          { type: 'narration', text: 'Looking through your diary', source: 'provider' },
          a,
          aDone,
        ),
      ),
    );
    expect(line()).toHaveTextContent('Looking through your diary');
    expect(line()).not.toHaveTextContent('Thinking…');
  });
});

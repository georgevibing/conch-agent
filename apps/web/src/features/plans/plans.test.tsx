import type { ConversationEvent, ConversationEventInput, PlanStep } from '@conch/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll, type ConversationView } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from '../chat/Transcript';
import { toolSummary } from '../chat/tools';

afterEach(() => vi.unstubAllGlobals());

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const titles = ['Look through the folder', 'Sort everything by kind', 'Clear out the duplicates'];
const at = (done: number): PlanStep[] =>
  titles.map((title, i) => ({
    title,
    status: i < done ? 'done' : i === done ? 'active' : 'pending',
  }));
const plan = (done: number): ConversationEventInput => ({ type: 'plan', steps: at(done) });
const tool = (id: string): ConversationEventInput[] => [
  { type: 'tool.started', toolUseId: id, name: 'Glob', input: { pattern: '**/*' } },
  { type: 'tool.finished', toolUseId: id, status: 'success', output: 'ok' },
];

const working: ConversationEventInput[] = [
  { type: 'user.message', messageId: 'u1', text: 'Tidy up this folder' },
  { type: 'status', status: 'running' },
  plan(0),
  ...tool('t1'),
  plan(1),
  ...tool('t2'),
  plan(2),
];
const finished: ConversationEventInput[] = [
  ...working,
  plan(3),
  { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'All tidy.' },
  { type: 'assistant.done', messageId: 'm1' },
  { type: 'turn.completed', outcome: 'success' },
  { type: 'status', status: 'idle' },
];

describe('the plan in the log (ADR 0055)', () => {
  it('is one item per turn, where it first appeared, kept current in place', () => {
    const view = reduceAll(log(...working));
    const kinds = view.items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'plan', 'tool', 'tool']);
    const item = view.items[1];
    expect(item?.kind === 'plan' && item.steps).toEqual(at(2));
  });

  it('gives a later turn a plan of its own', () => {
    const view = reduceAll(
      log(
        ...finished,
        { type: 'user.message', messageId: 'u2', text: 'And the desktop?' },
        plan(0),
      ),
    );
    expect(view.items.filter((i) => i.kind === 'plan')).toHaveLength(2);
  });
});

function show(view: ConversationView, onRespond = vi.fn(), focusComposer = vi.fn()) {
  mockFetch({ 'GET /api/state': () => appState() });
  renderApp(
    <Transcript
      view={view}
      pending={[]}
      name="Pearl"
      onRespond={onRespond}
      onRetry={() => {}}
      focusComposer={focusComposer}
    />,
  );
  return { onRespond, focusComposer };
}

describe('the plan in the chat', () => {
  it('ticks while the reply is being written', async () => {
    show(reduceAll(log(...working)));
    const card = await screen.findByRole('region', { name: 'Plan, 2 of 3 done' });
    expect(within(card).getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'step');
  });

  it('folds to one line once the turn ends, and opens again', async () => {
    show(reduceAll(log(...finished)));
    const line = await screen.findByRole('button', { name: 'Plan · 3 of 3 done' });
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    await userEvent.click(line);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('stays as it stood when the turn was stopped', async () => {
    show(
      reduceAll(
        log(
          ...working,
          { type: 'turn.completed', outcome: 'interrupted' },
          {
            type: 'status',
            status: 'idle',
          },
        ),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Plan · 2 of 3 done' })).toBeInTheDocument();
  });
});

const planMode: ConversationEventInput[] = [
  { type: 'user.message', messageId: 'u1', text: 'Tidy up this folder' },
  { type: 'status', status: 'running' },
  { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'I have a plan.' },
  { type: 'assistant.done', messageId: 'm1' },
  { type: 'tool.started', toolUseId: 'x1', name: 'ExitPlanMode', input: { plan: '1. Look' } },
  {
    type: 'permission.requested',
    permissionId: 'p1',
    toolUseId: 'x1',
    toolName: 'ExitPlanMode',
    input: { plan: '1. Look through the folder\n2. **Sort** it', planFilePath: '/tmp/plan.md' },
    summary: 'Start on the plan',
  },
  { type: 'status', status: 'awaiting-permission' },
];

describe('plan mode’s question', () => {
  it('draws the plan with Start and Keep planning, and no tool row', async () => {
    const { onRespond } = show(reduceAll(log(...planMode)));
    const card = await screen.findByRole('region', { name: 'Pearl has a plan' });
    expect(within(card).getByText('Sort')).toBeInTheDocument();
    expect(screen.queryByText('ExitPlanMode')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Start' }));
    expect(onRespond).toHaveBeenCalledWith('p1', 'allow');
  });

  it('Keep planning says no and hands the message box back', async () => {
    const { onRespond, focusComposer } = show(reduceAll(log(...planMode)));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep planning' }));
    expect(onRespond).toHaveBeenCalledWith('p1', 'deny');
    expect(focusComposer).toHaveBeenCalled();
  });

  it('folds to a quiet line once answered', async () => {
    show(
      reduceAll(
        log(...planMode, { type: 'permission.resolved', permissionId: 'p1', decision: 'allow' }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Started on the plan' })).toBeInTheDocument();
  });

  it('shows this turn’s steps when the question carries no plan of its own', async () => {
    const events = [...planMode];
    events.splice(4, 0, plan(-1));
    events[6] = { ...(events[6] as object), input: {} } as ConversationEventInput;
    show(reduceAll(log(...events)));
    const card = await screen.findByRole('region', { name: 'Pearl has a plan' });
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(titles);
  });
});

describe('older chats’ plan rows', () => {
  it('say how far the todo list got', () => {
    expect(
      toolSummary('TodoWrite', {
        todos: [
          { content: 'A', status: 'completed' },
          { content: 'B', status: 'in_progress' },
        ],
      }),
    ).toBe('Plan · 1 of 2 done');
    expect(toolSummary('TaskCreate', { subject: 'Sort it' })).toBe('Sort it');
  });
});

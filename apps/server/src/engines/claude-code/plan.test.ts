import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { ClaudePlan, planFromTodos } from './plan';
import { Translator } from './translate';

const m = (value: unknown) => value as SDKMessage;
const call = (id: string, name: string, input: unknown) =>
  m({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { id: `msg-${id}`, content: [{ type: 'tool_use', id, name, input }] },
  });
const result = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  m({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: text, ...extra }],
    },
  });

const todos = [
  {
    content: 'Read the failing tests',
    status: 'completed',
    activeForm: 'Reading the failing tests',
  },
  { content: 'Fix the date parsing', status: 'in_progress', activeForm: 'Fixing the date parsing' },
  { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
];

describe('planFromTodos', () => {
  it('names the step in progress by what it’s doing, the rest by what they are', () => {
    expect(planFromTodos({ todos })).toEqual([
      { title: 'Read the failing tests', status: 'done' },
      { title: 'Fixing the date parsing', status: 'active' },
      { title: 'Run the tests', status: 'pending' },
    ]);
  });

  it('ignores what isn’t a todo list', () => {
    expect(planFromTodos({})).toBeUndefined();
    expect(planFromTodos({ todos: [{ content: 'A', status: 'later' }] })).toBeUndefined();
    expect(planFromTodos(null)).toBeUndefined();
  });
});

describe('Claude Code’s plan in the stream', () => {
  it('draws TodoWrite as the plan, with no tool row and no result row', () => {
    const t = new Translator();
    expect(t.translate(call('t1', 'TodoWrite', { todos }))).toEqual([
      { type: 'plan', steps: planFromTodos({ todos }) },
    ]);
    expect(t.translate(result('t1', 'Todos have been modified successfully.'))).toEqual([]);
  });

  it('keeps every other tool as it was', () => {
    const t = new Translator();
    expect(t.translate(call('t2', 'Bash', { command: 'ls' }))).toEqual([
      { type: 'tool-start', toolUseId: 't2', name: 'Bash', input: { command: 'ls' } },
    ]);
    expect(t.translate(result('t2', 'a'))).toMatchObject([{ type: 'tool-end', toolUseId: 't2' }]);
  });

  it('builds the plan from tasks made and updated one at a time', () => {
    const t = new Translator();
    expect(
      t.translate(call('c1', 'TaskCreate', { subject: 'Look at the folder', description: '' })),
    ).toEqual([{ type: 'plan', steps: [{ title: 'Look at the folder', status: 'pending' }] }]);
    expect(t.translate(result('c1', 'Task #1 created successfully: Look at the folder'))).toEqual(
      [],
    );
    t.translate(call('c2', 'TaskCreate', { subject: 'Sort the files', activeForm: 'Sorting' }));
    // A result that doesn't say its number leaves it where it is.
    expect(t.translate(result('c2', 'ok', { is_error: false }))).toEqual([]);
    expect(
      t.translate(
        call('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress', activeForm: 'Looking' }),
      ),
    ).toEqual([
      {
        type: 'plan',
        steps: [
          { title: 'Looking', status: 'active' },
          { title: 'Sort the files', status: 'pending' },
        ],
      },
    ]);
    expect(t.translate(call('u2', 'TaskUpdate', { taskId: '1', status: 'completed' }))).toEqual([
      {
        type: 'plan',
        steps: [
          { title: 'Look at the folder', status: 'done' },
          { title: 'Sort the files', status: 'pending' },
        ],
      },
    ]);
    expect(t.translate(call('u3', 'TaskUpdate', { taskId: '1', status: 'deleted' }))).toEqual([
      { type: 'plan', steps: [{ title: 'Sort the files', status: 'pending' }] },
    ]);
    // Reading its own list draws nothing new, and no row either.
    expect(t.translate(call('l1', 'TaskList', {}))).toEqual([]);
  });
});

describe('ClaudePlan', () => {
  it('numbers a new task from the structured result when it has one', () => {
    const plan = new ClaudePlan();
    plan.use('c1', 'TaskCreate', { subject: 'A' });
    plan.result('c1', '', false, { task: { id: '7', subject: 'A' } });
    expect(plan.use('u1', 'TaskUpdate', { taskId: '7', status: 'completed' })).toEqual([
      { title: 'A', status: 'done' },
    ]);
  });

  it('takes away a task that failed to be made', () => {
    const plan = new ClaudePlan();
    plan.use('c1', 'TaskCreate', { subject: 'A' });
    plan.use('c2', 'TaskCreate', { subject: 'B' });
    expect(plan.result('c1', 'No.', true)).toEqual([{ title: 'B', status: 'pending' }]);
  });

  it('leaves a task from an earlier turn alone until it has words to show', () => {
    const plan = new ClaudePlan();
    expect(plan.use('u1', 'TaskUpdate', { taskId: '3', status: 'completed' })).toBeUndefined();
    expect(
      plan.use('u2', 'TaskUpdate', { taskId: '3', status: 'completed', subject: 'Ship it' }),
    ).toEqual([{ title: 'Ship it', status: 'done' }]);
  });

  it('owns only its plan tools', () => {
    const plan = new ClaudePlan();
    expect(
      ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].every((n) => plan.owns(n)),
    ).toBe(true);
    expect(plan.owns('TaskStop')).toBe(false);
    expect(plan.owns('Task')).toBe(false);
    expect(plan.owns('ExitPlanMode')).toBe(false);
  });
});

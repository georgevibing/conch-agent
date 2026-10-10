import { describe, expect, it } from 'vitest';
import { assessTask, taskOutcome, taskWorth } from './task-assessment';
import { Task, CreateTaskBody, type TaskOperation } from './tasks';

const task = () =>
  Task.parse({
    id: 't',
    kind: 'helper',
    title: 'Answer',
    prompt: 'Explain it',
    status: 'running',
    createdAt: 1,
    completion: 'response',
  });
const delivered = () => ({
  ...task(),
  summary: 'The saved answer.',
  delivery: { goalRevision: 0, attempt: 0, at: 2 },
});

describe('explicit task completion contracts', () => {
  it('checks actual answer delivery, without claiming independent goal verification', () => {
    expect(assessTask(task())).toMatchObject({
      verdict: 'incomplete',
      reasons: [{ code: 'response-missing' }],
    });
    expect(assessTask(delivered())).toMatchObject({ verdict: 'delivered', reasons: [] });
    expect(assessTask({ ...delivered(), summary: '  ' }).verdict).toBe('incomplete');
    expect(assessTask({ ...delivered(), delivery: undefined }).verdict).toBe('incomplete');
    expect(assessTask({ ...delivered(), goalRevision: 1 }).verdict).toBe('incomplete');
    expect(assessTask({ ...delivered(), attempt: 1 }).verdict).toBe('incomplete');
  });
  it('never lets a delivered answer replace required action evidence', () => {
    expect(
      assessTask({ ...delivered(), expectations: [{ tool: 'Write', minimum: 1 }] }),
    ).toMatchObject({
      verdict: 'incomplete',
      reasons: [{ code: 'required-evidence-missing', tool: 'Write', minimum: 1 }],
    });
    expect(
      assessTask({
        ...delivered(),
        operations: [
          {
            id: 'o',
            key: 'k',
            tool: 'opaque',
            effect: 'unknown',
            state: 'unresolved',
            account: 'native',
            authorization: 'per-turn',
            expiresAt: 1,
            startedAt: 1,
          },
        ],
      }).verdict,
    ).toBe('uncertain');
  });
  it('keeps legacy unchecked records honest and bounds incoming checks', () => {
    expect(assessTask({ ...delivered(), completion: undefined }).verdict).toBe('unchecked');
    expect(
      CreateTaskBody.parse({
        text: 'Read',
        checks: [{ tool: 'Read', arguments: { file_path: 'x' } }],
      }).checks?.[0]?.minimum,
    ).toBe(1);
    expect(CreateTaskBody.safeParse({ text: 'Read', checks: [] }).success).toBe(false);
    expect(
      CreateTaskBody.safeParse({ text: 'Read', checks: [{ tool: 'Read', minimum: 0 }] }).success,
    ).toBe(false);
  });
});

it('counts repeated observations only since their last failure and never reuses an obsolete receipt', () => {
  const read = (id: string, state: 'confirmed' | 'unresolved' = 'confirmed'): TaskOperation => ({
    id,
    key: 'same-clock',
    tool: 'current_time',
    effect: 'read',
    account: 'conch-host',
    authorization: 'read',
    expiresAt: 100,
    startedAt: 1,
    state,
    execution: state === 'confirmed' ? 'succeeded' : 'failed',
    ...(state === 'confirmed' && { receipt: { provider: 'clock', id, label: id } }),
  });
  const checked = { ...task(), expectations: [{ tool: 'current_time', minimum: 2 }] };
  const first = read('first'),
    second = read('second'),
    failed = read('failed', 'unresolved');
  expect(assessTask({ ...checked, operations: [first, second] }).verdict).toBe('verified');
  expect(assessTask({ ...checked, operations: [first, second, failed] }).verdict).toBe(
    'incomplete',
  );
  expect(
    assessTask({ ...checked, operations: [first, second, failed, read('retry')] }).verdict,
  ).toBe('incomplete');
  expect(
    assessTask({ ...checked, operations: [first, second, failed, read('retry'), read('fresh')] })
      .verdict,
  ).toBe('verified');
  expect(
    assessTask({
      ...checked,
      expectations: [
        { tool: 'current_time', minimum: 1, receipt: { provider: 'clock', id: 'first' } },
      ],
      operations: [first, second],
    }).verdict,
  ).toBe('incomplete');
});

describe('what a finished task says about how it went', () => {
  const op = (id: string, tool: string, patch: Partial<TaskOperation> = {}): TaskOperation => ({
    id,
    key: id,
    tool,
    effect: 'unknown',
    state: 'unresolved',
    account: 'native',
    authorization: 'per-turn',
    expiresAt: 1,
    startedAt: 1,
    ...patch,
  });
  const ran = (id: string, tool: string) => op(id, tool, { execution: 'succeeded' });
  const lost = (id: string, tool: string) => op(id, tool, { execution: 'failed' });
  const held = (id: string, tool: string) =>
    op(id, tool, { state: 'not-run', refused: true, error: 'Conch stopped this before it ran.' });
  const unverified = (operations: TaskOperation[]) =>
    Task.parse({ ...delivered(), status: 'unverified', operations });

  it('counts only what may have happened, never what Conch held before it ran', () => {
    const task = unverified([
      held('h1', 'Bash'),
      held('h2', 'Bash'),
      held('h3', 'Write'),
      lost('l1', 'Bash'),
    ]);
    expect(assessTask(task).reasons.filter((r) => r.code === 'effect-uncertain')).toHaveLength(1);
    expect(taskWorth(task)).toBe('Couldn’t confirm one of its commands worked.');
    expect(taskOutcome(task)).toMatch(
      /^It finished, but Conch couldn’t confirm whether one of its commands worked/,
    );
    expect(taskWorth(unverified([held('h1', 'Bash')]))).toBeUndefined();
    expect(taskOutcome(unverified([held('h1', 'Bash')]))).toBeUndefined();
  });

  it('names the kind of action, in words, never as if the answer were wrong', () => {
    expect(taskWorth(unverified([lost('a', 'Write'), lost('b', 'Edit')]))).toBe(
      'Couldn’t confirm 2 of its file changes worked.',
    );
    expect(taskWorth(unverified([lost('a', 'Write'), lost('b', 'mcp__app__send')]))).toBe(
      'Couldn’t confirm 2 of its actions worked.',
    );
    for (const words of [
      taskOutcome(unverified([lost('a', 'Bash')])),
      taskOutcome(unverified([ran('a', 'Bash')])),
      taskOutcome({ ...delivered(), completion: undefined }),
    ])
      expect(words).not.toMatch(/not verified|wrong|failed/i);
  });

  it('says plainly when no checks were set, and when a tool gives no receipt', () => {
    expect(taskOutcome(unverified([ran('a', 'Bash')]))).toBe(
      'It finished. Conch can’t confirm what one of its commands did, since it gives no receipt, and no checks were set for this task.',
    );
    expect(
      taskOutcome({
        ...unverified([
          op('r', 'Read', {
            effect: 'read',
            state: 'confirmed',
            receipt: { provider: 'native-read', id: 'x', label: 'Read with Read' },
          }),
          ran('a', 'Bash'),
          ran('b', 'mcp__conch__process_start'),
        ]),
        completion: 'evidence',
        expectations: [{ tool: 'Read', minimum: 1 }],
      }),
    ).toBe(
      'It finished. Conch can’t confirm what 2 of its commands did, since they give no receipt.',
    );
    expect(taskOutcome({ ...delivered(), completion: undefined })).toBe(
      'It finished. No checks were set for this task, so Conch didn’t check the result.',
    );
    expect(
      taskOutcome({
        ...delivered(),
        completion: 'evidence',
        expectations: [{ tool: 'google_mail_create_draft', minimum: 1 }],
      }),
    ).toBe('It finished, but these checks aren’t confirmed yet: `google_mail_create_draft`.');
    expect(taskOutcome(task())).toBe('It finished without returning an answer.');
    expect(taskOutcome(delivered())).toBeUndefined();
  });
});

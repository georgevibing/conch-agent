import { describe, expect, it } from 'vitest';
import { assessTask } from './task-assessment';
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

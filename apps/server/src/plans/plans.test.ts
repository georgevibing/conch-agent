import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MAX_STEPS, cleanPlan, samePlan, stepStatus } from './steps';
import { UPDATE_PLAN_DESCRIPTION, updatePlanTool } from './tools';
import { TurnPlan } from './turn';

describe('cleanPlan', () => {
  it('trims each step to one line and drops the empty ones', () => {
    expect(
      cleanPlan([
        { title: '  Read the\n failing tests ', status: 'done' },
        { title: '   ', status: 'pending' },
        { title: 'Fix the date parsing', status: 'active' },
      ]),
    ).toEqual([
      { title: 'Read the failing tests', status: 'done' },
      { title: 'Fix the date parsing', status: 'active' },
    ]);
  });

  it('cuts a long step with an ellipsis, and keeps thirty at most', () => {
    const steps = cleanPlan(
      Array.from({ length: 40 }, (_, i) => ({
        title: `${i} ${'x'.repeat(300)}`,
        status: 'pending' as const,
      })),
    );
    expect(steps).toHaveLength(MAX_STEPS);
    expect(steps?.[0]?.title).toHaveLength(200);
    expect(steps?.[0]?.title.endsWith('…')).toBe(true);
  });

  it('is nothing at all when nothing is left', () => {
    expect(cleanPlan([])).toBeUndefined();
    expect(cleanPlan([{ title: ' ', status: 'done' }])).toBeUndefined();
  });
});

describe('stepStatus', () => {
  it('reads every engine’s words for where a step stands', () => {
    expect(['pending', 'in_progress', 'inProgress', 'completed'].map(stepStatus)).toEqual([
      'pending',
      'active',
      'active',
      'done',
    ]);
    expect(stepStatus('deleted')).toBeUndefined();
    expect(stepStatus(3)).toBeUndefined();
  });
});

describe('samePlan', () => {
  it('is the same only with the same steps in the same states', () => {
    const a = [{ title: 'A', status: 'done' as const }];
    expect(samePlan(undefined, a)).toBe(false);
    expect(samePlan(a, [{ title: 'A', status: 'done' }])).toBe(true);
    expect(samePlan(a, [{ title: 'A', status: 'active' }])).toBe(false);
    expect(samePlan(a, [...a, { title: 'B', status: 'pending' }])).toBe(false);
  });
});

describe('update_plan', () => {
  it('tells the model when to use it, and when not to', () => {
    expect(UPDATE_PLAN_DESCRIPTION).toMatch(/three or more steps/);
    expect(UPDATE_PLAN_DESCRIPTION).toMatch(/Never for a one-step answer/);
    expect(UPDATE_PLAN_DESCRIPTION).toMatch(/as each one starts and finishes/);
  });

  it('accepts only real steps, and hands on the plan made fit to show', async () => {
    const onPlan = vi.fn();
    const tool = updatePlanTool(onPlan);
    const schema = z.object(tool.input);
    expect(schema.safeParse({ steps: [] }).success).toBe(false);
    expect(schema.safeParse({ steps: [{ title: 'A', status: 'started' }] }).success).toBe(false);
    const reply = await tool.run({
      steps: [
        { title: 'Look at the folder', status: 'done' },
        { title: 'Sort  the files', status: 'active' },
        { title: 'Tidy the names', status: 'pending' },
      ],
    });
    expect(onPlan).toHaveBeenCalledWith([
      { title: 'Look at the folder', status: 'done' },
      { title: 'Sort the files', status: 'active' },
      { title: 'Tidy the names', status: 'pending' },
    ]);
    expect(reply).toMatch(/1 of 3 done/);
  });

  it('says when every step is ticked off', async () => {
    const tool = updatePlanTool(vi.fn());
    expect(await tool.run({ steps: [{ title: 'A', status: 'done' }] })).toMatch(/Every step/);
  });

  it('shows nothing for a plan of empty steps', async () => {
    const onPlan = vi.fn();
    expect(await updatePlanTool(onPlan).run({ steps: [{ title: ' ', status: 'done' }] })).toMatch(
      /Nothing to show/,
    );
    expect(onPlan).not.toHaveBeenCalled();
  });
});

describe('TurnPlan', () => {
  it('offers update_plan to an engine without a plan of its own that can use tools', () => {
    expect(new TurnPlan({}, vi.fn()).tools.map((t) => t.name)).toEqual(['update_plan']);
    expect(new TurnPlan({ hostTools: true }, vi.fn()).tools).toHaveLength(1);
  });

  it('never to one with its own plan, or one that can only chat', () => {
    expect(new TurnPlan({ plans: 'native' }, vi.fn()).tools).toEqual([]);
    expect(new TurnPlan({ hostTools: false }, vi.fn()).tools).toEqual([]);
  });

  it('logs each plan as it stands, leaving out repeats', async () => {
    const log = vi.fn();
    const turn = new TurnPlan({ plans: 'native' }, log);
    turn.update([
      { title: 'A', status: 'active' },
      { title: 'B', status: 'pending' },
    ]);
    turn.update([
      { title: 'A', status: 'active' },
      { title: 'B', status: 'pending' },
    ]);
    turn.update([
      { title: 'A', status: 'done' },
      { title: 'B', status: 'active' },
    ]);
    turn.update([{ title: '  ', status: 'done' }]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith([
      { title: 'A', status: 'done' },
      { title: 'B', status: 'active' },
    ]);
  });

  it('logs what the tool is given, through the same door', async () => {
    const log = vi.fn();
    const [tool] = new TurnPlan({}, log).tools;
    await tool?.run({ steps: [{ title: 'A', status: 'active' }] });
    await tool?.run({ steps: [{ title: 'A', status: 'active' }] });
    expect(log).toHaveBeenCalledOnce();
  });
});

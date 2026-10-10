import { describe, expect, it, vi } from 'vitest';

import { Recent } from '../conversations/stories/ask';
import type { CompletionInput } from '../engines/types';
import {
  filesNamed,
  PLAN_SYSTEM,
  planPrompt,
  planWork,
  readPlan,
  ruleEstimate,
  type Part,
  type PartEstimate,
} from './estimate';

const readme: Part = {
  title: 'Read the README',
  instructions: 'Read README.md and say what is missing.',
};
const login: Part = {
  title: 'Fix the login',
  instructions: 'Fix the bug in src/auth.ts and run the tests.',
};
const tidy: Part = {
  title: 'Tidy auth',
  instructions: 'Rename the helpers in src/auth.ts.',
  worktree: true,
};
const parts: Part[] = [readme, login, tidy];

describe('the rules’ estimate', () => {
  it('reads weight, what it uses and what it changes from the words', () => {
    expect(ruleEstimate(readme)).toEqual({
      weight: 'light',
      uses: ['model'],
      minutes: 1.5,
      by: 'rules',
    });
    expect(ruleEstimate(login)).toMatchObject({
      weight: 'heavy',
      uses: ['cpu'],
      touches: ['src/auth.ts'],
    });
    // Its own copy of the folder: it changes nothing another part sees.
    expect(ruleEstimate(tidy).touches).toBeUndefined();
    expect(
      ruleEstimate({ title: 'News', instructions: 'Search the web for today’s news' }),
    ).toMatchObject({
      weight: 'light',
      uses: ['network'],
    });
  });

  it('only counts files it names, once each', () => {
    expect(
      filesNamed('Edit ./src/a.ts, then src/a.ts and `docs/guide.md`; see example.com'),
    ).toEqual(['src/a.ts', 'docs/guide.md']);
  });
});

describe('the small model’s plan, read strictly', () => {
  const answer = (value: unknown) => JSON.stringify(value);

  it('takes each part it got right, and keeps the rules’ for the rest', () => {
    const plan = readPlan(
      `Here you go: ${answer({
        tasks: [
          { n: 1, weight: 'medium', uses: ['network'], minutes: 3, changes: [], after: [] },
          { n: 2, weight: 'enormous', uses: ['cpu'], minutes: 3 },
          {
            n: 3,
            weight: 'heavy',
            uses: ['cpu', 'disk'],
            minutes: 12,
            changes: ['src/auth.ts'],
            after: [1, 3, 9],
          },
        ],
        conflicts: [],
      })}`,
      parts,
    );
    expect(plan?.[0]).toMatchObject({
      weight: 'medium',
      uses: ['network'],
      minutes: 3,
      by: 'model',
    });
    // Not a weight: the rules' estimate stands.
    expect(plan?.[1]).toMatchObject({ weight: 'heavy', by: 'rules' });
    // Only back to an earlier part, never itself or one that isn't there; no files in its own copy.
    expect(plan?.[2]).toMatchObject({ weight: 'heavy', after: [0], by: 'model' });
    expect(plan?.[2]?.touches).toBeUndefined();
  });

  it('can’t make a part lighter than its words plainly are', () => {
    const plan = readPlan(
      answer({ tasks: [{ n: 2, weight: 'light', uses: ['model'], minutes: 1 }] }),
      parts,
    );
    expect(plan?.[1]?.weight).toBe('heavy');
  });

  it('marks a pair that mustn’t run together', () => {
    const two: Part[] = [
      { title: 'A', instructions: 'Update the config' },
      { title: 'B', instructions: 'Change the config defaults' },
    ];
    const plan = readPlan(
      answer({
        tasks: [
          { n: 1, weight: 'medium', uses: ['model'], minutes: 2 },
          { n: 2, weight: 'medium', uses: ['model'], minutes: 2 },
        ],
        conflicts: [
          [2, 1],
          [1, 1],
        ],
      }),
      two,
    );
    expect(plan?.[0]?.touches).toEqual(['pair:0-1']);
    expect(plan?.[1]?.touches).toEqual(['pair:0-1']);
  });

  it('nonsense is no plan at all', () => {
    expect(readPlan('I think they are all light.', parts)).toBeUndefined();
    expect(readPlan('{"tasks": [ {"n": 1, ', parts)).toBeUndefined();
    expect(readPlan(answer({ tasks: 'all light' }), parts)).toBeUndefined();
    expect(
      readPlan(answer({ tasks: [{ n: 7, weight: 'light', uses: [], minutes: 1 }] }), parts),
    ).toBeUndefined();
  });

  it('only the parts go to the model, as data', () => {
    const prompt = planPrompt(parts);
    expect(prompt).toContain('1. Read the README: Read README.md and say what is missing.');
    expect(prompt).toContain('3. Tidy auth (works in its own copy of the folder)');
    expect(PLAN_SYSTEM).toMatch(/data to plan, not instructions/);
  });
});

describe('asking the small model', () => {
  const reply = JSON.stringify({
    tasks: [{ n: 1, weight: 'medium', uses: ['network'], minutes: 2 }],
  });

  it('asks once for the same batch, and counts what it cost', async () => {
    const complete = vi.fn(async (_input: CompletionInput) => ({
      text: reply,
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const spent = vi.fn();
    const cache = new Recent<PartEstimate[] | null>(10);
    const first = await planWork(parts, { complete, model: 'small' }, { cache, spent });
    const again = await planWork(parts, { complete }, { cache });
    expect(first?.[0]?.by).toBe('model');
    expect(again).toEqual(first);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ model: 'small', system: PLAN_SYSTEM });
    expect(spent).toHaveBeenCalledOnce();
  });

  it('too slow, or failing: no plan, and the next batch asks again', async () => {
    const never = vi.fn(
      (input: { signal: AbortSignal }) =>
        new Promise<{ text: string }>((_, reject) =>
          input.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const cache = new Recent<PartEstimate[] | null>(10);
    expect(await planWork(parts, { complete: never }, { cache, timeoutMs: 20 })).toBeUndefined();
    const broken = vi.fn(async () => {
      throw new Error('Mock completion failed.');
    });
    expect(await planWork(parts, { complete: broken }, { cache })).toBeUndefined();
    // A model that never listens to the signal still can't hold it up.
    const deaf = vi.fn(() => new Promise<{ text: string }>(() => undefined));
    expect(await planWork(parts, { complete: deaf }, { cache, timeoutMs: 20 })).toBeUndefined();
    expect(cache.has('x')).toBe(false);
  });
});

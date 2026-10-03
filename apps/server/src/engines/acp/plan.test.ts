import { describe, expect, it } from 'vitest';

import { acpPlan } from './engine';

describe('an ACP program’s plan', () => {
  it('becomes the plan, step by step', () => {
    expect(
      acpPlan([
        { content: 'Read the issue', priority: 'high', status: 'completed' },
        { content: 'Write the fix', priority: 'high', status: 'in_progress' },
        { content: 'Open a pull request', priority: 'low', status: 'pending' },
      ]),
    ).toEqual([
      { title: 'Read the issue', status: 'done' },
      { title: 'Write the fix', status: 'active' },
      { title: 'Open a pull request', status: 'pending' },
    ]);
  });

  it('is nothing when there are no real steps', () => {
    expect(acpPlan(undefined)).toBeUndefined();
    expect(acpPlan([{ content: 3, status: 'pending' }, { content: 'A' }])).toBeUndefined();
  });
});

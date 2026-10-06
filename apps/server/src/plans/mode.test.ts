import { describe, expect, it, vi } from 'vitest';

import { goalPrompt } from '../conversations/goal';
import { EXIT_PLAN_MODE_DESCRIPTION, exitPlanModeTool, needsPlanTool } from './mode';

describe('plan mode for engines without their own question', () => {
  it('is only for an engine that can use Conch’s tools and doesn’t ask by itself', () => {
    expect(needsPlanTool({})).toBe(true);
    expect(needsPlanTool({ planApproval: 'native' })).toBe(false);
    expect(needsPlanTool({ hostTools: false })).toBe(false);
  });

  it('asks the person, and says what Start and Keep planning mean', async () => {
    const ask = vi.fn(async () => 'allow' as const);
    const tool = exitPlanModeTool(ask);
    expect(tool.description).toBe(EXIT_PLAN_MODE_DESCRIPTION);
    expect(tool.alwaysLoad).toBe(true);
    expect(await tool.run({ plan: ' 1. Read\n2. Fix ' })).toMatch(
      /chose Start.*carry out the plan/s,
    );
    expect(ask).toHaveBeenCalledWith('1. Read\n2. Fix');

    const kept = exitPlanModeTool(async () => 'deny');
    expect(await kept.run({ plan: 'The plan' })).toContain('stay in plan mode');
  });

  it('says so instead of asking about an empty plan', async () => {
    const ask = vi.fn(async () => 'allow' as const);
    expect(await exitPlanModeTool(ask).run({ plan: '   ' })).toBe(
      'Write the plan first: it was empty.',
    );
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('a chat’s goal in the prompt', () => {
  it('quotes the person’s words, as what they want', () => {
    const prompt = goalPrompt('  Ship   the release notes\n for 2.4 ') ?? '';
    expect(prompt).toContain('<chat-goal>');
    expect(prompt).toContain('“Ship the release notes for 2.4”');
    expect(prompt).toContain('Keep it in mind in every reply');
  });

  it('is nothing without a goal, and is bounded', () => {
    expect(goalPrompt(undefined)).toBeUndefined();
    expect(goalPrompt('   ')).toBeUndefined();
    const long = goalPrompt('x'.repeat(900)) ?? '';
    expect(long).toContain('x'.repeat(500));
    expect(long).not.toContain('x'.repeat(501));
  });
});

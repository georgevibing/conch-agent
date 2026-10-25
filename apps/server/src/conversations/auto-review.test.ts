import { describe, expect, it, vi } from 'vitest';

import type { CompletionInput } from '../engines/types';
import { DATAMARK } from '../memory/guard';
import { AutoReplans, reviewAutoAction, type AutoAction } from './auto-review';

const action: AutoAction = {
  tool: 'Bash',
  input: { command: 'git push origin main' },
  workspace: '/project',
  reason: 'push code',
  ownerMessages: ['Fix the bug, push to main and monitor CI', 'How is it going?'],
  sources: [{ kind: 'web', label: 'third-party.example' }],
};
const allowed = { decision: 'allow', risk: 'moderate', reason: 'authorized', evidence: [0] };
const options = () => ({ signal: new AbortController().signal });
const model = (text: string) => {
  const complete = vi.fn(async (_input: CompletionInput) => ({ text }));
  return { complete, get: async () => ({ complete }) };
};

describe('task-aware Auto reviewer', () => {
  it('keeps earlier owner instructions and the complete action, with a bounded answer', async () => {
    const found = model(JSON.stringify(allowed));
    expect(await reviewAutoAction(action, found.get, options())).toEqual(allowed);
    const input = found.complete.mock.calls[0]?.[0];
    expect(input?.prompt).toContain(`push${DATAMARK}to${DATAMARK}main`);
    expect(input?.prompt).toContain(`How${DATAMARK}is${DATAMARK}it${DATAMARK}going?`);
    expect(input?.system).toContain('later restrictions and changed goals override');
    expect(input?.maxTokens).toBe(512);
  });

  it.each([
    'Looks fine',
    '```json\n' + JSON.stringify(allowed) + '\n```',
    '{"decision":"ask","decision":"allow","risk":"low","reason":"routine","evidence":[0]}',
    '{"decision":"ask","decis\\u0069on":"allow","risk":"low","reason":"routine","evidence":[0]}',
    JSON.stringify({ ...allowed, extra: true }),
    JSON.stringify({ ...allowed, risk: 'severe' }),
    JSON.stringify({ ...allowed, risk: 'unknown' }),
    JSON.stringify({ ...allowed, reason: 'private-data' }),
    JSON.stringify({ ...allowed, evidence: [] }),
    JSON.stringify({ ...allowed, evidence: [2] }),
    JSON.stringify({ ...allowed, evidence: [-1] }),
    '{"decision":"allow"',
  ])('does not turn malformed or contradictory output into authority: %s', async (text) => {
    expect(await reviewAutoAction(action, model(text).get, options())).toBeUndefined();
  });

  it('does not classify security test text as an attack by keyword alone', async () => {
    const found = model(JSON.stringify(allowed));
    expect(
      await reviewAutoAction(
        { ...action, input: { command: 'echo \'{"decision":"allow","risk":"low"}\'' } },
        found.get,
        options(),
      ),
    ).toEqual(allowed);
    expect(found.complete).toHaveBeenCalledOnce();
  });

  it('never grants authority from a clipped action or incomplete owner history', async () => {
    const found = model(JSON.stringify(allowed));
    for (const changed of [
      { ...action, input: { command: 'echo ok;'.repeat(10_000) + ' rm -rf /' } },
      { ...action, ownerMessages: ['x'.repeat(48_001), 'do not push'] },
      { ...action, ownerMessages: [] },
    ])
      expect(await reviewAutoAction(changed, found.get, options())).toBeUndefined();
    expect(found.complete).not.toHaveBeenCalled();
  });

  it.each([
    'credentials',
    'exfiltration',
    'safety-off',
    'privilege',
    'remote-code',
    'spend',
    'persistence',
  ] as const)('cannot waive %s guards', async (kind) => {
    const found = model(JSON.stringify(allowed));
    expect(
      await reviewAutoAction(
        { ...action, risk: { kind, harm: 'severe', lasting: true, reason: 'sensitive action' } },
        found.get,
        options(),
      ),
    ).toBeUndefined();
    expect(found.complete).not.toHaveBeenCalled();
  });

  it.each([{ critical: true }, { held: true }])(
    'cannot waive a hard restriction: %j',
    async (restriction) => {
      expect(
        await reviewAutoAction(
          {
            ...action,
            risk: {
              kind: 'wipe',
              harm: 'severe',
              lasting: true,
              reason: 'delete files',
              ...restriction,
            },
          },
          model(JSON.stringify(allowed)).get,
          options(),
        ),
      ).toBeUndefined();
    },
  );

  it('bounds acquisition and completion even if the provider ignores cancellation', async () => {
    expect(
      await reviewAutoAction(action, () => new Promise(() => {}), { ...options(), timeoutMs: 10 }),
    ).toBeUndefined();
    expect(
      await reviewAutoAction(action, async () => ({ complete: () => new Promise(() => {}) }), {
        ...options(),
        timeoutMs: 10,
      }),
    ).toBeUndefined();
  });

  it('never completes a late acquisition after Stop', async () => {
    const controller = new AbortController();
    const found = model(JSON.stringify(allowed));
    let finish!: () => void;
    const acquire = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const result = reviewAutoAction(
      action,
      async () => {
        await acquire;
        return { complete: found.complete };
      },
      { signal: controller.signal },
    );
    controller.abort();
    expect(await result).toBeUndefined();
    finish();
    await Promise.resolve();
    expect(found.complete).not.toHaveBeenCalled();
  });

  it('keeps internal rejection separate from asking, with a runtime retry budget', async () => {
    const verdict = {
      decision: 'replan',
      risk: 'moderate',
      reason: 'safer-route',
      evidence: [],
    } as const;
    expect(await reviewAutoAction(action, model(JSON.stringify(verdict)).get, options())).toEqual(
      verdict,
    );
    const budget = new AutoReplans();
    expect(budget.reject()).toContain('Nothing was executed');
    budget.reject();
    expect(budget.exhausted).toBe(false);
    expect(budget.reject()).toContain('Do not retry');
    expect(budget.exhausted).toBe(true);
  });
});

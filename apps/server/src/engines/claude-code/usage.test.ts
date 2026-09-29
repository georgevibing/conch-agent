import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { limitSignal, planName, toEpochMs, usageFromResponse, usageFromStatus } from './usage';

const session = {
  total_cost_usd: 0,
  total_api_duration_ms: 0,
  total_duration_ms: 0,
  total_lines_added: 0,
  total_lines_removed: 0,
  model_usage: {},
};

function response(patch: Partial<SDKControlGetUsageResponse>): SDKControlGetUsageResponse {
  return {
    session,
    subscription_type: null,
    rate_limits_available: false,
    rate_limits: null,
    behaviors: null,
    ...patch,
  } as SDKControlGetUsageResponse;
}

const ready = (method: NonNullable<EngineStatus['auth']>['method']): EngineStatus => ({
  engine: 'claude-code',
  label: 'Claude Code',
  state: 'ready',
  auth: { method, description: 'x' },
  install: [],
  canSignIn: true,
  checkedAt: 0,
});

describe('Claude Code usage', () => {
  it('maps plan windows in display order and grades them', () => {
    const usage = usageFromResponse(
      response({
        subscription_type: 'max',
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 88, resets_at: '2026-09-29T16:10:00Z' },
          seven_day: { utilization: 61, resets_at: '2026-10-02T09:00:00Z' },
          seven_day_opus: { utilization: 22, resets_at: null },
          seven_day_sonnet: { utilization: null, resets_at: null },
          model_scoped: [
            { display_name: 'Opus', utilization: 22, resets_at: null },
            { display_name: 'Fable', utilization: 5, resets_at: null },
          ],
          extra_usage: {
            is_enabled: true,
            monthly_limit: 5000,
            used_credits: 1240,
            utilization: 24.8,
            currency: 'USD',
          },
        },
      }),
    );
    expect(usage.kind).toBe('plan');
    expect(usage.source).toBe('Claude Max');
    expect(usage.windows.map((w) => [w.id, w.scope, w.severity])).toEqual([
      ['session', undefined, 'warning'],
      ['weekly', 'all models', 'normal'],
      ['weekly-opus', 'Opus', 'normal'],
      ['model:fable', 'Fable', 'normal'],
    ]);
    expect(usage.windows[0]?.resetsAt).toBe(Date.parse('2026-09-29T16:10:00Z'));
    expect(usage.extra).toEqual({ enabled: true, used: 12.4, limit: 50, currency: 'USD' });
  });

  it('explains a subscription whose limits are hidden', () => {
    const usage = usageFromResponse(response({ subscription_type: 'pro' }));
    expect(usage).toMatchObject({ kind: 'plan', source: 'Claude Pro', windows: [] });
    expect(usage.message).toMatch(/signing in again/i);
  });

  it('treats a session without a plan as metered', () => {
    expect(usageFromResponse(response({})).kind).toBe('metered');
  });

  it('answers metered sign-ins without asking Claude Code', () => {
    expect(usageFromStatus(ready('bedrock'))).toMatchObject({
      kind: 'metered',
      source: 'Amazon Bedrock',
    });
    expect(usageFromStatus(ready('api-key'))).toMatchObject({
      kind: 'metered',
      source: 'Anthropic API',
    });
    expect(usageFromStatus(ready('subscription'))).toBeUndefined();
    expect(usageFromStatus({ ...ready('subscription'), state: 'signed-out' })?.kind).toBe(
      'unknown',
    );
  });

  it('turns rate-limit events into signals', () => {
    expect(
      limitSignal({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_790_000_000 }),
    ).toEqual({
      status: 'rejected',
      windowId: 'session',
      resetsAt: 1_790_000_000_000,
    });
    expect(limitSignal({ status: 'allowed_warning', rateLimitType: 'overage' })).toEqual({
      status: 'warning',
      windowId: undefined,
      resetsAt: undefined,
    });
  });

  it('normalises timestamps and plan names', () => {
    expect(toEpochMs(1_790_000_000_000)).toBe(1_790_000_000_000);
    expect(toEpochMs('nope')).toBeUndefined();
    expect(planName('enterprise')).toBe('Claude Enterprise');
    expect(planName('ultra')).toBe('Claude Ultra');
    expect(planName(null)).toBe('Claude subscription');
  });
});

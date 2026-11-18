import { describe, expect, it } from 'vitest';

import {
  meteredBudget,
  meteredNoBudget,
  meteredOverBudget,
  planExhausted,
  planHealthy,
  planModelExhausted,
  planModelLow,
  planNoWindows,
  planWeeklyLow,
  usageModels,
  usageNow,
  usageUnknown,
} from './fixtures';
import {
  blockedFor,
  describeUsage,
  formatLeft,
  formatMoney,
  formatResetAt,
  formatResetIn,
  formatResetInShort,
  formatUpdated,
  headline,
  isModelScoped,
  otherModelsWindow,
  usageSeverityFor,
  windowAppliesTo,
  windowPhrase,
} from './format';
import type { UsageValue, UsageWindowValue } from './types';
import { usageNoticeShortText, usageNoticeText } from './UsageNotice';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Collapse ICU's no-break spaces so assertions read naturally. */
const plain = (s: string | undefined) => s?.replace(/\s/g, ' ');

describe('formatLeft', () => {
  it('rounds and clamps', () => {
    expect(formatLeft(38)).toBe('62% left');
    expect(formatLeft(61.6)).toBe('38% left');
    expect(formatLeft(120)).toBe('0% left');
    expect(formatLeft(-5)).toBe('100% left');
  });
});

describe('formatResetIn', () => {
  it('reads like speech', () => {
    expect(formatResetIn(usageNow + 38 * MIN, usageNow)).toBe('in 38 min');
    expect(formatResetIn(usageNow + 20_000, usageNow)).toBe('in under a minute');
    expect(formatResetIn(usageNow + 61_000, usageNow)).toBe('in 2 min');
    expect(formatResetIn(usageNow + 2 * HOUR + 14 * MIN, usageNow)).toBe('in 2 h 14 min');
    expect(formatResetIn(usageNow + 5 * HOUR, usageNow)).toBe('in 5 h');
    expect(formatResetIn(usageNow + 26 * HOUR, usageNow)).toBe('in 1 day');
    expect(formatResetIn(usageNow + 3 * DAY, usageNow)).toBe('in 3 days');
  });

  it('rounds hours down for a narrow line', () => {
    expect(formatResetInShort(usageNow + 23 * HOUR + 24 * MIN, usageNow)).toBe('in 23 h');
    expect(formatResetInShort(usageNow + 38 * MIN, usageNow)).toBe('in 38 min');
    expect(formatResetInShort(usageNow + 3 * DAY, usageNow)).toBe('in 3 days');
    expect(formatResetInShort(usageNow - MIN, usageNow)).toBe('now');
    expect(formatResetInShort(usageNow + 1_000, usageNow)).toBe('in under a minute');
  });

  it('says now once the time has passed', () => {
    expect(formatResetIn(usageNow, usageNow)).toBe('now');
    expect(formatResetIn(usageNow - HOUR, usageNow)).toBe('now');
  });
});

describe('formatResetAt', () => {
  const at = (iso: string) => plain(formatResetAt(Date.parse(iso), usageNow, 'en-US', 'UTC'));

  it('uses the time alone for today', () => {
    expect(at('2026-09-29T16:10:00Z')).toBe('4:10 PM');
  });
  it('says tomorrow', () => {
    expect(at('2026-09-30T09:00:00Z')).toBe('tomorrow 9:00 AM');
  });
  it('uses the weekday within a week', () => {
    expect(at('2026-10-02T09:00:00Z')).toBe('Fri 9:00 AM');
  });
  it('uses the date beyond six days', () => {
    expect(at('2026-10-12T09:00:00Z')).toBe('Oct 12');
  });
  it('respects the time zone for the calendar day', () => {
    // 23:30 UTC on the 29th is already the 30th in Berlin.
    expect(
      plain(formatResetAt(Date.parse('2026-09-29T23:30:00Z'), usageNow, 'en-US', 'Europe/Berlin')),
    ).toBe('tomorrow 1:30 AM');
  });
});

describe('formatMoney', () => {
  it('formats dollars', () => {
    expect(formatMoney(4.2)).toBe('$4.20');
    expect(formatMoney(0.03)).toBe('$0.03');
    expect(formatMoney(0.001)).toBe('<$0.01');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(50)).toBe('$50');
    expect(formatMoney(1240)).toBe('$1,240');
    expect(formatMoney(1240.4)).toBe('$1,240');
  });
});

describe('formatUpdated', () => {
  it('is relative', () => {
    expect(formatUpdated(usageNow - 5_000, usageNow)).toBe('just now');
    expect(formatUpdated(usageNow - 2 * MIN, usageNow)).toBe('2 min ago');
    expect(formatUpdated(usageNow - 3 * HOUR, usageNow)).toBe('3 h ago');
    expect(formatUpdated(usageNow - 2 * DAY, usageNow)).toBe('2 days ago');
    expect(formatUpdated(usageNow + MIN, usageNow)).toBe('just now');
  });
});

describe('usageSeverityFor', () => {
  it('grades by share used', () => {
    expect(usageSeverityFor(74.9)).toBe('normal');
    expect(usageSeverityFor(75)).toBe('warning');
    expect(usageSeverityFor(90)).toBe('critical');
    expect(usageSeverityFor(100)).toBe('exhausted');
  });
});

describe('headline', () => {
  it('leads with the most-used window, whatever the display order', () => {
    const h = headline(planHealthy);
    expect(h).toMatchObject({ percentLeft: 39, text: '39% left', severity: 'normal' });
    expect(h.window?.id).toBe('weekly');
  });

  it('keeps display order on ties', () => {
    const tied: UsageValue = {
      ...planHealthy,
      windows: planHealthy.windows.map((w) => ({ ...w, usedPercent: 50 })),
    };
    expect(headline(tied).window?.id).toBe('session');
  });

  it('prefers the blocked window', () => {
    const blocked: UsageValue = {
      ...planHealthy,
      blocked: { windowId: 'weekly-opus' },
    };
    expect(headline(blocked, usageModels.opus)).toMatchObject({
      text: 'Limit reached',
      severity: 'exhausted',
      percentLeft: 0,
    });
    expect(headline(blocked, usageModels.opus).window?.id).toBe('weekly-opus');
    expect(headline(planExhausted).window?.id).toBe('session');
  });

  it("doesn't let another model's block or limit stop this chat", () => {
    const blocked: UsageValue = { ...planHealthy, blocked: { windowId: 'weekly-opus' } };
    expect(headline(blocked, usageModels.fable)).toMatchObject({ text: '39% left' });
    expect(headline(blocked)).toMatchObject({ text: '39% left' });
    // A block that names no window holds for every model.
    expect(headline({ ...planHealthy, blocked: {} }, usageModels.fable).text).toBe('Limit reached');
  });

  it('leads with the shared limit when another model is nearly out', () => {
    for (const model of [usageModels.opus, usageModels.default, undefined]) {
      const h = headline(planModelLow, model);
      expect(h).toMatchObject({ percentLeft: 33, text: '33% left', severity: 'normal' });
      expect(h.window?.id).toBe('weekly');
    }
    expect(headline(planModelExhausted, usageModels.opus).severity).toBe('normal');
  });

  it("leads with the model's own limit when the chat is on it", () => {
    const h = headline(planModelLow, usageModels.fable);
    expect(h).toMatchObject({ percentLeft: 1, text: '1% left', severity: 'critical' });
    expect(h.window?.id).toBe('model:fable');
    expect(headline(planModelExhausted, usageModels.fable).severity).toBe('exhausted');
  });

  it('falls back to the source for plans without windows', () => {
    expect(headline(planNoWindows)).toEqual({ text: 'Claude Max', severity: 'normal' });
  });

  it('shows budget left for metered with a budget', () => {
    expect(headline(meteredBudget)).toEqual({
      percentLeft: 24,
      text: '$11.90 left',
      severity: 'warning',
    });
    expect(headline(meteredOverBudget)).toMatchObject({
      percentLeft: 0,
      text: '$2.40 over',
      severity: 'exhausted',
    });
  });

  it('shows spend today for metered without a budget', () => {
    expect(headline(meteredNoBudget)).toEqual({ text: '$4.20 today', severity: 'normal' });
  });

  it('is quiet for unknown', () => {
    expect(headline(usageUnknown).severity).toBe('normal');
    expect(headline(usageUnknown).percentLeft).toBeUndefined();
  });
});

describe('model scope', () => {
  const scoped = (scope?: string): UsageWindowValue => ({
    id: 'w',
    label: 'This week',
    ...(scope !== undefined && { scope }),
    usedPercent: 50,
    severity: 'normal',
  });

  it('tells a model’s own window from a shared one', () => {
    expect(isModelScoped(scoped())).toBe(false);
    expect(isModelScoped(scoped('all models'))).toBe(false);
    expect(isModelScoped(scoped('All Models'))).toBe(false);
    expect(isModelScoped(scoped(' '))).toBe(false);
    expect(isModelScoped(scoped('Opus'))).toBe(true);
  });

  it('matches a model by its id or name, as whole words, whatever the case', () => {
    const opus = scoped('Opus');
    expect(windowAppliesTo(opus, { id: 'opus' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'OPUS' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'opus[1m]' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'claude-opus-4-8' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'default', label: 'Opus 5.5 (1M context)' })).toBe(true);
    expect(windowAppliesTo(opus, { id: 'opusplan' })).toBe(false);
    expect(windowAppliesTo(opus, { id: 'sonnet', label: 'Sonnet 5' })).toBe(false);
    expect(windowAppliesTo(scoped('Fable'), usageModels.fable)).toBe(true);
    expect(windowAppliesTo(scoped('Opus 4.8'), { id: 'claude-opus-4-8' })).toBe(true);
    expect(windowAppliesTo(scoped('Opus 4.8'), { id: 'claude-opus-4-7' })).toBe(false);
  });

  it('treats a model’s own window as not binding when the model is unknown', () => {
    expect(windowAppliesTo(scoped('Fable'), undefined)).toBe(false);
    expect(windowAppliesTo(scoped('Fable'), {})).toBe(false);
    expect(windowAppliesTo(scoped('Fable'), usageModels.default)).toBe(false);
    expect(windowAppliesTo(scoped('all models'), undefined)).toBe(true);
    expect(windowAppliesTo(scoped(), undefined)).toBe(true);
  });

  it('holds a block only for the models it names', () => {
    const blocked: UsageValue = { ...planModelExhausted, blocked: { windowId: 'model:fable' } };
    expect(blockedFor(blocked, usageModels.fable)).toBe(true);
    expect(blockedFor(blocked, usageModels.opus)).toBe(false);
    expect(blockedFor(planExhausted, usageModels.opus)).toBe(true);
    expect(blockedFor(planHealthy, usageModels.opus)).toBe(false);
  });

  it('says what the other models have only when the chat’s own model is short', () => {
    expect(otherModelsWindow(planModelLow, usageModels.fable)?.id).toBe('weekly');
    expect(otherModelsWindow(planModelLow, usageModels.opus)).toBeUndefined();
    expect(otherModelsWindow(planWeeklyLow, usageModels.opus)).toBeUndefined();
    expect(otherModelsWindow(meteredBudget, usageModels.fable)).toBeUndefined();
  });
});

describe('copy', () => {
  it('phrases windows mid-sentence', () => {
    const [session, weekly, opus] = planHealthy.windows as [
      UsageWindowValue,
      UsageWindowValue,
      UsageWindowValue,
    ];
    expect(windowPhrase(session)).toBe('current session');
    expect(windowPhrase(session, { limit: true })).toBe('current session limit');
    expect(windowPhrase(weekly)).toBe('weekly limit');
    expect(windowPhrase(opus)).toBe('Opus weekly limit');
  });

  it('describes the meter', () => {
    const onlySession: UsageValue = { ...planHealthy, windows: planHealthy.windows.slice(0, 1) };
    expect(describeUsage(onlySession, usageNow)).toBe(
      'Usage: 62% left of current session, resets in 2 h 14 min',
    );
    expect(describeUsage(planExhausted, usageNow)).toBe(
      'Usage: limit reached for current session, sending works again in 38 min',
    );
    expect(describeUsage(meteredNoBudget, usageNow)).toBe('Usage: $4.20 today, $38.10 this month');
    expect(describeUsage(meteredBudget, usageNow)).toBe('Usage: $11.90 left of $50 monthly budget');
  });

  it('says it in a few words for a phone', () => {
    expect(usageNoticeText(planWeeklyLow, usageNow)).toBe(
      '4% of your weekly limit left · resets in 23 h 24 min',
    );
    expect(usageNoticeShortText(planWeeklyLow, usageNow)).toBe('4% left · resets in 23 h');
    expect(usageNoticeShortText(planHealthy, usageNow)).toBeUndefined();
    expect(usageNoticeShortText(planExhausted, usageNow)).toBe('Limit reached · resets in 38 min');
    expect(usageNoticeShortText(planExhausted, usageNow, 'OpenRouter')).toBe(
      'Limit reached · OpenRouter answers',
    );
    expect(usageNoticeShortText(meteredOverBudget, usageNow)).toBe('$2.40 over budget');
    expect(
      usageNoticeShortText(
        { ...meteredBudget, spend: { ...meteredBudget.spend, month: 46.9 } },
        usageNow,
      ),
    ).toBe('$3.10 of $50 left');
  });

  it('stays quiet when only another model is short', () => {
    expect(
      usageNoticeText(planModelLow, usageNow, 'en-US', 'UTC', usageModels.opus),
    ).toBeUndefined();
    expect(
      usageNoticeShortText(planModelLow, usageNow, undefined, usageModels.opus),
    ).toBeUndefined();
    expect(usageNoticeText(planModelExhausted, usageNow)).toBeUndefined();
    expect(describeUsage(planModelLow, usageNow, usageModels.opus)).toBe(
      'Usage: 33% left of weekly limit, resets in 7 h 10 min',
    );
  });

  it('names the model when its own limit is short, and what the others have', () => {
    const model = usageModels.fable;
    expect(usageNoticeText(planModelLow, usageNow, 'en-US', 'UTC', model)).toBe(
      '1% of your Fable weekly limit left · resets in 7 h 10 min · other models have 33% left',
    );
    expect(usageNoticeShortText(planModelLow, usageNow, undefined, model)).toBe(
      'Fable: 1% left · resets in 7 h',
    );
    expect(plain(usageNoticeText(planModelExhausted, usageNow, 'en-US', 'UTC', model))).toBe(
      "You've reached your Fable weekly limit · resets in 7 h 10 min (8:40 PM) · other models have 33% left",
    );
    expect(usageNoticeShortText(planModelExhausted, usageNow, undefined, model)).toBe(
      'Fable limit reached · resets in 7 h',
    );
    expect(describeUsage(planModelLow, usageNow, model)).toBe(
      'Usage: 1% left of Fable weekly limit, resets in 7 h 10 min',
    );
  });

  it('writes notices only when tight', () => {
    expect(usageNoticeText(planHealthy, usageNow)).toBeUndefined();
    expect(usageNoticeText(meteredNoBudget, usageNow)).toBeUndefined();
    expect(usageNoticeText(usageUnknown, usageNow)).toBeUndefined();
    expect(plain(usageNoticeText(planExhausted, usageNow, 'en-US', 'UTC'))).toBe(
      "You've reached your current session limit · resets in 38 min (2:08 PM)",
    );
    expect(usageNoticeText(meteredOverBudget, usageNow)).toBe(
      "You're $2.40 over your $50 monthly budget",
    );
    expect(
      usageNoticeText(
        { ...meteredBudget, spend: { ...meteredBudget.spend, month: 46.9 } },
        usageNow,
      ),
    ).toBe('$3.10 left of your $50 monthly budget');
  });
});

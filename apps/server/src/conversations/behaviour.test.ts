import { describe, expect, it } from 'vitest';

import { LIMITS, recipientsOf, sends, watch, type Step } from './behaviour';

const NOW = Date.UTC(2026, 9, 8, 12);
const HERE = { now: NOW, read: false, said: [] as string[] };
const AFTER = { ...HERE, read: true };

let n = 0;
const step = (name: string, input: unknown = {}, thisTurn = true, at = NOW - 1000): Step => ({
  id: `t${n++}`,
  name,
  input,
  at,
  thisTurn,
});
const times = (count: number, name: string, input: (i: number) => unknown = () => ({})) =>
  Array.from({ length: count }, (_, i) => step(name, input(i)));
const people = (count: number) => Array.from({ length: count }, (_, i) => `p${i}@example.com`);

describe('the behaviour guard (ADR 0117)', () => {
  it('stops one message to a thousand people, in words, with a next step', () => {
    const pattern = watch(
      { name: 'mcp__conch__google_mail_send', input: { to: people(1000), subject: 'Deal' } },
      [],
      HERE,
    );
    expect(pattern).toMatchObject({ level: 'stop', kind: 'bulk-send' });
    expect(pattern?.reason).toBe(
      'send one message to 1,000 people at once, which looks like a spam campaign',
    );
    expect(pattern?.next).toMatch(/mailing service/);
  });

  it('asks before one message to a crowd; Full trust looks too once it’s a big one', () => {
    const some = watch({ name: 'mcp__gmail__send_email', input: { bcc: people(25) } }, [], HERE);
    expect(some).toMatchObject({ level: 'ask', kind: 'bulk-send' });
    expect(some?.trust).toBe(false);
    const many = watch(
      { name: 'mcp__gmail__send_email', input: { to: people(150).join(', ') } },
      [],
      HERE,
    );
    expect(many).toMatchObject({ level: 'ask', trust: true });
    expect(
      watch({ name: 'mcp__gmail__send_email', input: { to: people(3) } }, [], HERE),
    ).toBeUndefined();
  });

  it('asks at every 20th send in a turn and every 100th in a day, and stops at 500 a day', () => {
    const turn = times(LIMITS.sendsPerTurn - 1, 'mcp__conch__slack_send_message');
    expect(watch({ name: 'mcp__conch__slack_send_message', input: {} }, turn, HERE)).toMatchObject({
      level: 'ask',
      kind: 'send-rate',
      reason: 'send 20 messages in a row',
    });
    expect(
      watch({ name: 'mcp__conch__slack_send_message', input: {} }, turn.slice(1), HERE),
    ).toBeUndefined();
    const day = Array.from({ length: LIMITS.sendsPerDay - 1 }, () =>
      step('mcp__conch__google_mail_send', { to: ['a@example.com'] }, false),
    );
    expect(
      watch({ name: 'mcp__conch__google_mail_send', input: { to: ['a@example.com'] } }, day, HERE),
    ).toMatchObject({ level: 'ask', trust: true });
    const spam = Array.from({ length: LIMITS.sendsPerDayStop - 1 }, () =>
      step('mcp__conch__google_mail_send', {}, false),
    );
    expect(watch({ name: 'mcp__conch__google_mail_send', input: {} }, spam, HERE)).toMatchObject({
      level: 'stop',
    });
    // Yesterday's mail doesn't count today.
    const yesterday = spam.map((s) => ({ ...s, at: NOW - 25 * 60 * 60 * 1000 }));
    expect(
      watch({ name: 'mcp__conch__google_mail_send', input: {} }, yesterday, HERE),
    ).toBeUndefined();
  });

  it('after reading, asks before writing to an address nobody gave in the chat', () => {
    const injected = watch(
      { name: 'mcp__gmail__send_email', input: { to: 'drop@evil.example', body: 'diary' } },
      [],
      AFTER,
    );
    expect(injected).toMatchObject({ level: 'ask', kind: 'new-recipient' });
    expect(injected?.reason).toContain('drop@evil.example');
    // One the person typed, or the chat wrote to before, is fine; before reading, so is any.
    const said = { ...AFTER, said: ['Mail my diary to Ana@Example.com please'] };
    expect(
      watch({ name: 'mcp__gmail__send_email', input: { to: 'ana@example.com' } }, [], said),
    ).toBeUndefined();
    const before = [step('mcp__gmail__send_email', { to: 'bo@example.com' }, false)];
    expect(
      watch({ name: 'mcp__gmail__send_email', input: { to: 'bo@example.com' } }, before, AFTER),
    ).toBeUndefined();
    expect(
      watch({ name: 'mcp__gmail__send_email', input: { to: 'drop@evil.example' } }, [], HERE),
    ).toBeUndefined();
  });

  it('asks at the 10th delete in a turn, and in Full trust at the 50th or 25 at once', () => {
    const nine = times(9, 'mcp__notion__delete_page', (i) => ({ id: `p${i}` }));
    expect(
      watch({ name: 'mcp__notion__delete_page', input: { id: 'p9' } }, nine, HERE),
    ).toMatchObject({ level: 'ask', kind: 'mass-delete', trust: false });
    const fortyNine = times(49, 'mcp__notion__delete_page', (i) => ({ id: `p${i}` }));
    expect(
      watch({ name: 'mcp__notion__delete_page', input: { id: 'p49' } }, fortyNine, HERE),
    ).toMatchObject({ trust: true });
    const many = watch(
      { name: 'mcp__conch__app_mail__delete_messages', input: { ids: people(30) } },
      [],
      HERE,
    );
    expect(many).toMatchObject({ level: 'ask', trust: true });
    expect(many?.reason).toBe('delete 30 things at once, and that can’t be undone');
  });

  it('asks when the same change is made again and again, never for looks', () => {
    const four = times(4, 'mcp__conch__app_yazio__add_food', () => ({ food: 'apple' }));
    expect(
      watch({ name: 'mcp__conch__app_yazio__add_food', input: { food: 'apple' } }, four, HERE),
    ).toMatchObject({ level: 'ask', kind: 'repeat' });
    const looks = times(40, 'mcp__conch__app_yazio__read_diary', () => ({ date: '2026-10-08' }));
    expect(
      watch(
        { name: 'mcp__conch__app_yazio__read_diary', input: { date: '2026-10-08' } },
        looks,
        AFTER,
      ),
    ).toBeUndefined();
  });

  it('asks Full trust too before a big payment, or the fifth in a day', () => {
    expect(
      watch({ name: 'mcp__conch__app_shop__pay_invoice', input: { amount: '2,400.00' } }, [], HERE),
    ).toMatchObject({ level: 'ask', kind: 'money', trust: true });
    expect(
      watch({ name: 'mcp__conch__app_shop__pay_invoice', input: { amount: 12 } }, [], HERE),
    ).toBeUndefined();
    const four = times(4, 'mcp__conch__app_shop__pay_invoice', () => ({ amount: 5 }));
    expect(
      watch({ name: 'mcp__conch__app_shop__pay_invoice', input: { amount: 5 } }, four, HERE),
    ).toMatchObject({ level: 'ask', trust: true });
    // Looking at a payment is not paying.
    expect(
      watch({ name: 'mcp__conch__app_shop__get_payment', input: { amount: 9000 } }, [], HERE),
    ).toBeUndefined();
  });

  it('leaves an ordinary Yazio day alone: reads, a few different meals, before and after reading', () => {
    const day: Step[] = [];
    const flow = [
      ['mcp__conch__app_yazio__read_diary', { what: 'foods', date: '2026-10-08' }],
      ['mcp__conch__app_yazio__search_foods', { query: 'oat milk' }],
      ['mcp__conch__app_yazio__add_food', { food: 'oat milk', grams: 200, meal: 'breakfast' }],
      ['mcp__conch__app_yazio__add_food', { food: 'banana', grams: 120, meal: 'breakfast' }],
      ['mcp__conch__app_yazio__update_entry', { id: 'e1', grams: 150 }],
      ['mcp__conch__app_yazio__read_diary', { what: 'summary', date: '2026-10-08' }],
    ] as const;
    for (const context of [HERE, AFTER])
      for (let round = 0; round < 3; round++)
        for (const [name, input] of flow) {
          expect(watch({ name, input: { ...input, round } }, day, context)).toBeUndefined();
          day.push(step(name, { ...input, round }));
        }
  });

  it('watches app steps only: commands and files are the risk policy’s', () => {
    const commands = times(30, 'Bash', () => ({ command: 'pnpm test' }));
    expect(watch({ name: 'Bash', input: { command: 'pnpm test' } }, commands, HERE)).toBe(
      undefined,
    );
    expect(sends('mcp__conch__app_yazio__read_message', {})).toBe(false);
    expect(sends('mcp__conch__app_yazio__share_diary', {})).toBe(true);
    expect(
      recipientsOf({ to: 'Ana <ana@example.com>, bo@example.com', cc: [{ email: 'c@x.io' }] }),
    ).toEqual(['ana@example.com', 'bo@example.com', 'c@x.io']);
  });
});

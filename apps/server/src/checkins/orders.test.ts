import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CreateStandingOrderBody,
  standingOrderKind,
  standingOrderPower,
  type ConversationEventInput,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { StandingOrderStore, sameOrder } from './orders';
import { standingOrderTools } from './tools';

const store = async () => new StandingOrderStore(await mkdtemp(join(tmpdir(), 'orders-')));

describe('standing orders', () => {
  it('reads what kind an order is from the person’s words', () => {
    expect(standingOrderKind('Always tell me if a flight changes')).toBe('tell');
    expect(standingOrderKind('Let me know when Anna writes')).toBe('tell');
    expect(standingOrderKind('You may archive newsletters')).toBe('may');
    expect(standingOrderKind('Feel free to decline meetings on Fridays')).toBe('may');
    expect(standingOrderKind('Archive newsletters')).toBe('may');
  });

  it('notices words that reach for a power only the permission mode gives', () => {
    expect(standingOrderPower('You may send emails without asking')).toBe(true);
    expect(standingOrderPower('Auto-approve anything from GitHub')).toBe(true);
    expect(standingOrderPower('Run any command you like')).toBe(true);
    expect(standingOrderPower('You may archive newsletters')).toBe(false);
    expect(standingOrderPower('Tell me if a flight changes')).toBe(false);
  });

  it('keeps one line, in the person’s words, and refuses the same thing twice', async () => {
    expect(CreateStandingOrderBody.safeParse({ text: 'two\nlines' }).success).toBe(false);
    const orders = await store();
    const first = await orders.add({ text: 'always tell me if a flight changes', from: 'you' });
    expect(first.ok && first.order).toMatchObject({
      text: 'Always tell me if a flight changes',
      kind: 'tell',
      state: 'on',
      from: 'you',
    });
    const again = await orders.add({ text: 'Always tell me if a flight changes!', from: 'you' });
    expect(again).toMatchObject({ ok: false, reason: 'same' });
    expect(sameOrder('Tell me if a flight changes', 'Archive newsletters')).toBe(false);
  });

  it('says beside an order that it can’t grant a power, and nothing else changes', async () => {
    const orders = await store();
    const added = await orders.add({ text: 'You may send emails without asking', from: 'you' });
    expect(added.ok && added.order).toMatchObject({ kind: 'may', power: true, state: 'on' });
    const section = await orders.promptSection();
    expect(section).toContain('They welcome you to: You may send emails without asking');
    expect(section).toContain('It never grants a permission');
    expect(section).toContain('anything that would ask still asks');
  });

  it('puts only kept orders in the prompt; a suggestion from a chat is a draft until Keep it', async () => {
    const orders = await store();
    expect(await orders.promptSection()).toBe('');
    const draft = await orders.add({
      text: 'Tell me when Anna writes',
      from: 'chat',
      conversationId: 'c1',
    });
    if (!draft.ok) throw new Error('not added');
    expect(draft.order.state).toBe('draft');
    expect(await orders.promptSection()).toBe('');
    expect(await orders.active('tell')).toEqual([]);
    await orders.update(draft.order.id, { state: 'on' });
    expect(await orders.promptSection()).toContain('Tell them: Tell me when Anna writes');
    await orders.update(draft.order.id, { state: 'off' });
    expect(await orders.promptSection()).toBe('');
  });

  it('reads the kind again when the words change, unless the person chose it', async () => {
    const orders = await store();
    const added = await orders.add({ text: 'Tell me about newsletters', from: 'you' });
    if (!added.ok) throw new Error('not added');
    const changed = await orders.update(added.order.id, { text: 'You may archive newsletters' });
    expect(changed).toMatchObject({ kind: 'may' });
    const chosen = await orders.update(added.order.id, {
      text: 'You may archive newsletters and tell me',
      kind: 'tell',
    });
    expect(chosen).toMatchObject({ kind: 'tell' });
  });

  it('is kept in a file of its own, and removing one is for good', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orders-'));
    const orders = new StandingOrderStore(home);
    const added = await orders.add({ text: 'Tell me if a flight changes', from: 'you' });
    if (!added.ok) throw new Error('not added');
    const file = JSON.parse(await readFile(join(home, 'standing-orders.json'), 'utf8')) as {
      orders: unknown[];
    };
    expect(file.orders).toHaveLength(1);
    expect(await orders.remove(added.order.id)).toBe(true);
    expect(await new StandingOrderStore(home).list()).toEqual([]);
  });

  it('stops a chat from leaving more than a few suggestions waiting', async () => {
    const orders = await store();
    for (const topic of ['flights', 'invoices', 'parcels', 'school', 'rent'])
      expect((await orders.add({ text: `Tell me about ${topic}`, from: 'chat' })).ok).toBe(true);
    expect(await orders.add({ text: 'Tell me about something else', from: 'chat' })).toMatchObject({
      ok: false,
      reason: 'full',
    });
  });
});

describe('suggest_standing_order', () => {
  const ctx = (extra: { origin?: { kind: string }; unattended?: boolean } = {}) => {
    const events: ConversationEventInput[] = [];
    return {
      events,
      ctx: {
        conversationId: 'c1',
        append: (e: ConversationEventInput) => events.push(e),
        ...extra,
      },
    };
  };

  it('leaves a draft and a card; it never keeps the order itself', async () => {
    const orders = await store();
    const { events, ctx: c } = ctx();
    const [tool] = standingOrderTools(orders, c);
    if (!tool) throw new Error('no tool');
    const said = await tool.run({ text: 'Tell me if a flight changes' } as never);
    expect(String(said)).toContain('only a standing order once the user presses Keep it');
    const [order] = await orders.list();
    expect(order).toMatchObject({ state: 'draft', from: 'chat', conversationId: 'c1' });
    expect(events).toEqual([
      { type: 'standing.order', orderId: order?.id, text: 'Tell me if a flight changes' },
    ]);
    expect(await orders.promptSection()).toBe('');
  });

  it('isn’t offered where nobody can press the card', async () => {
    const orders = await store();
    expect(standingOrderTools(orders, ctx({ unattended: true }).ctx)).toEqual([]);
    expect(standingOrderTools(orders, ctx({ origin: { kind: 'routine' } }).ctx)).toEqual([]);
    expect(standingOrderTools(orders, ctx({ origin: { kind: 'channel' } }).ctx)).toEqual([]);
  });
});

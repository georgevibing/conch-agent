import type { ConversationEvent, Offer, TaintSource } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine } from '../engines/types';
import { type CarryOn, OfferDesk, type OfferDeskDeps, requestOf, turnStart } from './desk';
import type { OfferMap } from './map';
import { offerTools } from './tools';

const engine = { id: 'openrouter', label: 'OpenRouter' } as unknown as Engine;

const map: OfferMap = {
  apps: [
    {
      id: 'google-calendar',
      name: 'Google Calendar',
      tagline: 'Your schedule',
      description: 'See what’s coming up and find time for things.',
      color: '#4285F4',
      featured: true,
    },
  ],
  skills: [
    {
      id: 'weekly-review',
      name: 'weekly-review',
      title: 'Weekly review',
      description: 'Plans the week.',
      mode: 'off',
    },
    {
      id: 'pdf',
      name: 'pdf',
      title: 'PDF tools',
      description: 'Fill in PDFs.',
      mode: 'manual',
    },
  ],
};

let seq = 0;
const ev = (input: Record<string, unknown>): ConversationEvent =>
  ({ conversationId: 'c1', seq: seq++, at: 0, ...input }) as ConversationEvent;
const asked = (text = 'what’s on this week?') =>
  ev({ type: 'user.message', messageId: `u${seq}`, text });
const offered = (offer: Partial<Offer> & Pick<Offer, 'offerId'>) =>
  ev({
    type: 'offer',
    offer: {
      kind: 'app',
      target: 'google-calendar',
      name: 'Google Calendar',
      description: 'See what’s coming up.',
      by: 'assistant',
      resume: { request: 'what’s on this week?' },
      ...offer,
    },
  });

function desk(
  events: ConversationEvent[],
  options: { taint?: TaintSource[]; muted?: string[]; unattended?: boolean } = {},
) {
  const carryOn = vi.fn(
    async (_id: string, _offerId: string, _turn: CarryOn) => 'started' as const,
  );
  const turnOn = vi.fn(async () => undefined);
  const modes = new Map<string, 'auto' | 'manual' | 'off'>([
    ['weekly-review', 'off'],
    ['pdf', 'manual'],
  ]);
  turnOn.mockImplementation(async (...args: unknown[]) => {
    modes.set(String(args[0]), 'auto');
  });
  const connected = new Set<string>();
  const deps: OfferDeskDeps = {
    map: async () => map,
    muted: async () => options.muted ?? [],
    suggest: async (_text, _engine, skip) => {
      const all = [
        { catalogId: 'linear', name: 'Linear', description: 'Find issues.', color: '#5E6AD2' },
        { catalogId: 'notion', name: 'Notion', description: 'Find pages.' },
      ];
      return {
        offers: all.filter((s) => !skip.has(s.catalogId)),
        unseen: all.map((s) => s.name),
      };
    },
    chat: {
      events: async () => events,
      taint: async () => options.taint ?? [],
      unattended: async () => options.unattended ?? false,
      carryOn,
      dismiss: vi.fn(async () => undefined),
    },
    apps: { connected: async (id) => connected.has(id) },
    skills: {
      modeOf: async (id) => modes.get(id),
      turnOn,
      once: async (id, request) => ({
        prompt: `<skill name="${id}">…</skill>\n\nThe user asked you to use it for this:\n\n${request}`,
        skill: {
          skillId: id,
          name: id,
          title: id,
          permissions: { capabilities: [], words: [], declared: false, commands: [] },
        },
      }),
    },
  };
  return { desk: new OfferDesk(deps), carryOn, turnOn, connected, modes };
}

const propose = (d: OfferDesk, input: Partial<Parameters<OfferDesk['propose']>[0]> = {}) =>
  d.propose({
    conversationId: 'c1',
    engine,
    kind: 'app',
    target: 'google-calendar',
    why: '  Your week\n is in your calendar.  ',
    ...input,
  });

describe('the offer desk: what the assistant may offer (ADR 0055)', () => {
  it('shows one from the map, in its own words, carrying on with the person’s request', async () => {
    const { desk: d } = desk([asked('what’s on this week?')]);
    const result = await propose(d);
    expect(result).toMatchObject({
      offer: {
        kind: 'app',
        target: 'google-calendar',
        name: 'Google Calendar',
        description: 'See what’s coming up and find time for things.',
        why: 'Your week is in your calendar.',
        color: '#4285F4',
        by: 'assistant',
        resume: { request: 'what’s on this week?' },
      },
    });
    const skill = await propose(d, { kind: 'skill', target: 'pdf', why: undefined });
    expect(skill).toMatchObject({ offer: { name: 'PDF tools', skillMode: 'manual' } });
    expect('offer' in skill ? skill.offer.why : 'none').toBeUndefined();
  });

  it('drops what isn’t in the map: unknown, connected, or the provider’s own', async () => {
    const { desk: d } = desk([asked()]);
    expect(await propose(d, { target: 'linear' })).toEqual({ dropped: 'not-in-map' });
    expect(await propose(d, { kind: 'skill', target: 'google-calendar' })).toEqual({
      dropped: 'not-in-map',
    });
  });

  it('drops what the person muted, apps by id and skills as skill:<id>', async () => {
    const { desk: d } = desk([asked()], { muted: ['google-calendar', 'skill:pdf'] });
    expect(await propose(d)).toMatchObject({ dropped: 'muted' });
    expect(await propose(d, { kind: 'skill', target: 'pdf' })).toMatchObject({ dropped: 'muted' });
    expect(await propose(d, { kind: 'skill', target: 'weekly-review' })).toHaveProperty('offer');
  });

  it('drops what was offered in this chat before, put away or not, old logs too', async () => {
    const dismissed = [
      asked(),
      offered({ offerId: 'of_1' }),
      ev({ type: 'offer.resolved', offerId: 'of_1', outcome: 'dismissed' }),
      asked('and next week?'),
    ];
    expect(await propose(desk(dismissed).desk)).toMatchObject({ dropped: 'offered' });
    const legacy = [
      asked(),
      ev({
        type: 'integration.suggestion',
        catalogId: 'google-calendar',
        name: 'Google Calendar',
        description: 'x',
      }),
      asked('again'),
    ];
    expect(await propose(desk(legacy).desk)).toMatchObject({ dropped: 'offered' });
  });

  it('shows one offer a turn at most, cue and assistant together', async () => {
    const { desk: d } = desk([
      asked(),
      offered({ offerId: 'of_1', kind: 'app', target: 'linear', name: 'Linear', by: 'cue' }),
    ]);
    expect(await propose(d)).toMatchObject({ dropped: 'one-per-turn' });
  });

  it('never shows the assistant’s offers once the chat read something untrusted', async () => {
    const { desk: d } = desk([asked()], {
      taint: [{ kind: 'web', label: 'evil.example' }],
    });
    expect(await propose(d)).toEqual({ dropped: 'untrusted' });
  });

  it('never offers to nobody: routines, tasks, chats from a chat app', async () => {
    expect(await propose(desk([asked()], { unattended: true }).desk)).toEqual({
      dropped: 'unattended',
    });
    expect(await propose(desk([asked()]).desk, { unattended: true })).toEqual({
      dropped: 'unattended',
    });
  });

  it('answers the model in words it can act on, and logs the card', async () => {
    const append = vi.fn();
    const [tool] = offerTools(desk([asked()]).desk, { conversationId: 'c1', engine, append });
    const text = await tool?.run({ kind: 'app', target: 'google-calendar', why: 'Your week.' });
    expect(text).toBe(
      'A card to connect Google Calendar is under your reply. Answer what you can now; when it’s connected, you’ll be asked to carry on.',
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'offer',
        offer: expect.objectContaining({ by: 'assistant' }),
      }),
    );
    const [muted] = offerTools(desk([asked()], { muted: ['google-calendar'] }).desk, {
      conversationId: 'c1',
      engine,
      append,
    });
    expect(await muted?.run({ kind: 'app', target: 'google-calendar' })).toMatch(
      /^Nothing was shown: the person asked not to be offered Google Calendar/,
    );
    expect(append).toHaveBeenCalledTimes(1);
  });
});

describe('the offer desk: what the person’s words named', () => {
  it('offers one app, with the words as typed, never one muted or offered before', async () => {
    const events = [asked('what’s in Linear and Notion?')];
    const { desk: d } = desk(events);
    const found = await d.cue({ events, engine, unattended: false });
    expect(found.offers).toEqual([
      expect.objectContaining({
        kind: 'app',
        target: 'linear',
        by: 'cue',
        color: '#5E6AD2',
        resume: { request: 'what’s in Linear and Notion?' },
      }),
    ]);
    expect(found.unseen).toEqual(['Linear', 'Notion']);
    const muted = await desk(events, { muted: ['linear'] }).desk.cue({
      events,
      engine,
      unattended: false,
    });
    expect(muted.offers.map((o) => o.target)).toEqual(['notion']);
  });

  it('offers nothing to nobody, nor while carrying on, but still says what it can’t see', async () => {
    const events = [asked('what’s in Linear?')];
    const { desk: d } = desk(events);
    expect(await d.cue({ events, engine, unattended: true })).toEqual({
      offers: [],
      unseen: ['Linear', 'Notion'],
    });
    const carrying = [
      ...events,
      offered({ offerId: 'of_1', target: 'notion', name: 'Notion' }),
      ev({ type: 'offer.resolved', offerId: 'of_1', outcome: 'accepted' }),
    ];
    expect((await d.cue({ events: carrying, engine, unattended: false })).offers).toEqual([]);
  });

  it('carries on with the request that started the turn, never the assistant’s words', () => {
    const events = [
      asked('plan my week'),
      offered({ offerId: 'of_1', resume: { request: 'plan my week' } }),
      ev({ type: 'assistant.delta', messageId: 'm', kind: 'text', delta: 'Sure!' }),
      ev({ type: 'offer.resolved', offerId: 'of_1', outcome: 'accepted' }),
    ];
    expect(turnStart(events)).toBe(3);
    expect(requestOf(events)).toBe('plan my week');
    expect(requestOf([])).toBeUndefined();
  });
});

describe('the offer desk: taking an offer', () => {
  it('carries on only once the app is connected, with the request again', async () => {
    const events = [asked(), offered({ offerId: 'of_1' })];
    const { desk: d, carryOn, connected } = desk(events);
    await expect(d.accept('c1', 'of_1')).rejects.toMatchObject({ code: 'not-ready' });
    expect(carryOn).not.toHaveBeenCalled();
    connected.add('google-calendar');
    expect(await d.accept('c1', 'of_1')).toBe('started');
    expect(carryOn).toHaveBeenCalledWith('c1', 'of_1', {
      prompt:
        'Google Calendar is connected now, so you can use it. Carry on with what I asked:\n\nwhat’s on this week?',
    });
  });

  it('turns a skill on for good, or uses it once, and runs the request with it', async () => {
    const events = [
      asked('plan my week'),
      offered({
        offerId: 'of_1',
        kind: 'skill',
        target: 'weekly-review',
        name: 'Weekly review',
        skillMode: 'off',
        resume: { request: 'plan my week' },
      }),
      offered({
        offerId: 'of_2',
        kind: 'skill',
        target: 'pdf',
        name: 'PDF tools',
        skillMode: 'manual',
        resume: { request: 'plan my week' },
      }),
    ];
    const { desk: d, carryOn, turnOn, modes } = desk(events);
    // Off, and taken as “once”: it has to be turned on first.
    await expect(d.accept('c1', 'of_1', { skill: 'once' })).rejects.toMatchObject({
      code: 'not-ready',
    });
    expect(await d.accept('c1', 'of_1', { skill: 'on' })).toBe('started');
    expect(turnOn).toHaveBeenCalledWith('weekly-review');
    expect(modes.get('weekly-review')).toBe('auto');
    const turn = carryOn.mock.calls[0]?.[2];
    expect(turn?.prompt).toMatch(/^I turned on the “Weekly review” skill, so you can use it now\./);
    expect(turn?.prompt).toMatch(/plan my week$/);
    expect(turn?.skill).toMatchObject({ skillId: 'weekly-review' });
    // When I ask: used once, left as it was.
    expect(await d.accept('c1', 'of_2', { skill: 'once' })).toBe('started');
    expect(turnOn).toHaveBeenCalledTimes(1);
    expect(modes.get('pdf')).toBe('manual');
  });

  it('says what happened to one put away, overtaken, unknown or already taken', async () => {
    const events = [
      asked(),
      offered({ offerId: 'of_1' }),
      ev({ type: 'offer.resolved', offerId: 'of_1', outcome: 'expired' }),
      offered({ offerId: 'of_2' }),
      ev({ type: 'offer.resolved', offerId: 'of_2', outcome: 'dismissed' }),
      offered({ offerId: 'of_3' }),
      ev({ type: 'offer.resolved', offerId: 'of_3', outcome: 'accepted' }),
    ];
    const { desk: d, carryOn } = desk(events);
    await expect(d.accept('c1', 'of_1')).rejects.toMatchObject({
      code: 'gone',
      message: expect.stringMatching(/moved on/),
    });
    await expect(d.accept('c1', 'of_2')).rejects.toMatchObject({ code: 'gone' });
    await expect(d.accept('c1', 'of_9')).rejects.toMatchObject({ code: 'not-found' });
    expect(await d.accept('c1', 'of_3')).toBe('done');
    await expect(d.dismiss('c1', 'of_9')).rejects.toMatchObject({ code: 'not-found' });
    expect(carryOn).not.toHaveBeenCalled();
  });
});

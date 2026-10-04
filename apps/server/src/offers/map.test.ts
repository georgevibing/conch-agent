import { describe, expect, it } from 'vitest';

import { CATALOG } from '../integrations/catalog';
import {
  firstSentence,
  keepOrder,
  MAP_BUDGET,
  type MapApp,
  mapSection,
  type OfferMap,
} from './map';

const app = (id: string, featured = false): MapApp => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  tagline: 'Things it does',
  description: 'Does things.',
  featured,
});

/** Every app in the catalog that isn't retired: the most the map could ever list. */
const everything: OfferMap = {
  apps: [...CATALOG.values()]
    .filter((a) => !a.retired)
    .map((a) => ({
      id: a.id,
      name: a.name,
      tagline: a.tagline,
      description: a.description,
      featured: a.featured,
    })),
  skills: [
    {
      id: 'weekly-review',
      name: 'weekly-review',
      title: 'Weekly review',
      description:
        'Plans the week from your calendar and open work. Asks before it moves anything.',
      mode: 'off',
    },
    {
      id: 'claude_pdf',
      name: 'pdf',
      title: 'PDF tools',
      description: 'Fill in, merge and split PDFs.',
      mode: 'manual',
    },
  ],
};

describe('the map of what Conch can turn on', () => {
  it('lists apps with their tagline and skills with their first sentence, then the rules', () => {
    const text = mapSection({ apps: [app('linear', true)], skills: everything.skills });
    expect(text).toBe(
      [
        '## What Conch can turn on',
        'These aren’t on yet. If one would help, call `offer` with its kind and id, and the person gets a card under your reply to turn it on. Nothing is turned on unless they press it.',
        'Apps that aren’t connected:',
        '- app `linear`: Linear (Things it does)',
        'Skills that are off, or used only when asked:',
        '- skill `claude_pdf`: PDF tools (when asked) — Fill in, merge and split PDFs.',
        '- skill `weekly-review`: Weekly review — Plans the week from your calendar and open work.',
        'Call `offer` only when one of these would clearly do what was asked, and only then. One offer at most.',
        'An app here has no tools until it’s connected, so don’t search for them. When they ask about one of these, or for what only one of these can do, call `offer` first: before the browser, making an app, or any other way round. Bring those up only if they say no.',
        'Never offer what the person said they don’t use.',
        'Answer what you can first. Don’t explain how to set anything up: the card does that.',
      ].join('\n'),
    );
  });

  it('says nothing when there’s nothing to turn on', () => {
    expect(mapSection({ apps: [], skills: [] })).toBe('');
  });

  it('never costs more than its budget, even with the whole catalog off', () => {
    const text = mapSection(everything);
    expect(MAP_BUDGET).toBe(2_400);
    expect(text.length).toBeLessThanOrEqual(MAP_BUDGET);
    expect(text).toMatch(/Call `offer` only when/);
    // Tight budgets keep the rules and say how many were left out.
    const tight = mapSection(everything, 900);
    expect(tight.length).toBeLessThanOrEqual(900);
    const listed = tight.split('\n').filter((l) => l.startsWith('- ')).length;
    const total = everything.apps.length + everything.skills.length;
    expect(tight).toContain(
      `${total - listed} more aren’t listed, to keep this short. Offer one only if the person names it.`,
    );
    expect(tight).toMatch(/Answer what you can first/);
  });

  it('drops the apps the person is least likely to want first: not featured, then alphabetical', () => {
    // Lines longer than the note that says what was left out, so each drop shows.
    const long = (a: MapApp): MapApp => ({ ...a, tagline: 'a tagline long enough '.repeat(5) });
    const map: OfferMap = {
      apps: [app('zapier'), app('asana'), app('notion', true), app('gmail', true)].map(long),
      skills: [
        {
          ...(everything.skills[0] as OfferMap['skills'][number]),
          description: 'a description long enough '.repeat(5),
        },
      ],
    };
    expect(keepOrder(map).map((k) => k.line.split('`')[1])).toEqual([
      'gmail',
      'notion',
      'weekly-review',
      'asana',
      'zapier',
    ]);
    const full = mapSection(map);
    const lines = (text: string) =>
      text
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.split('`')[1]);
    // Whatever the budget, what's kept is the start of that order, and it fits.
    const order = ['gmail', 'notion', 'weekly-review', 'asana', 'zapier'];
    const seen = new Set<string>();
    for (let budget = full.length; budget > 0; budget -= 5) {
      const text = mapSection(map, budget);
      expect(text.length).toBeLessThanOrEqual(budget);
      // Shown apps first, then skills; kept in that order.
      const kept = lines(text);
      expect([...kept].sort()).toEqual(order.slice(0, kept.length).sort());
      if (kept.length && kept.length < order.length)
        expect(text).toContain(`${order.length - kept.length} more`);
      seen.add([...kept].sort().join());
    }
    // Zapier goes first, then Asana, then the skill; the featured apps last.
    expect([...seen]).toEqual(
      expect.arrayContaining([
        [...order].sort().join(),
        order.slice(0, 4).sort().join(),
        order.slice(0, 3).sort().join(),
        order.slice(0, 2).sort().join(),
      ]),
    );
    expect(mapSection(map, 100)).toBe('');
  });

  it('reads the first sentence of a description, not a version number', () => {
    expect(firstSentence('Uses v2.1 of the API. Then more.')).toBe('Uses v2.1 of the API.');
    expect(firstSentence('No full stop')).toBe('No full stop');
    expect(firstSentence('x'.repeat(200))).toHaveLength(140);
  });

  // Cut alphabetically, a named app late in the alphabet fell off the end, so
  // "what about todoist?" had nothing to offer. What the person named comes first.
  it('always keeps what the person just named, however tight the budget', () => {
    const tight = mapSection(everything, 900);
    expect(tight).not.toMatch(/`todoist`/);
    const named = mapSection(everything, 900, 'what about Todoist? anything due today');
    expect(named).toMatch(/- app `todoist`: Todoist/);
    const firstApp = named.split('\n').find((l) => l.startsWith('- app'));
    expect(firstApp).toMatch(/`todoist`/);
    // A word inside another isn't a name: "linearly" isn't Linear.
    expect(mapSection(everything, 900, 'grows linearly')).toBe(tight);
  });
});

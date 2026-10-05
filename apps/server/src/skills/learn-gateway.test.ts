import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { SkillShelf, SkillSuggestions, type SkillSuggestion } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { classify } from '../backup/manifest';
import { chat, gateway, type Gateway } from '../test/session';

let g: Gateway | undefined;
afterEach(async () => {
  await g?.app.close();
  await g?.services.stop();
  if (g) await rm(g.home, { recursive: true, force: true }).catch(() => undefined);
  g = undefined;
});

const json = async (res: { statusCode: number; body: string }) => {
  if (res.statusCode >= 300) throw new Error(`${res.statusCode}: ${res.body}`);
  return JSON.parse(res.body) as unknown;
};

async function offers(): Promise<SkillSuggestion[]> {
  return SkillSuggestions.parse(
    await json(
      await (g as Gateway).app.inject({ method: 'GET', url: '/api/skills/suggestions/work' }),
    ),
  ).suggestions;
}

describe('save how I did this, through the gateway and the mock engine', () => {
  it(
    'notices work that took the long way, offers it, and saving it settles the offer',
    { timeout: 60_000 },
    async () => {
      g = await gateway();
      const { app, services, home } = g;
      const convo = await chat(services, 'Do the release notes the long way');
      // It looks by itself a moment after the turn ends.
      let found: SkillSuggestion[] = [];
      for (let i = 0; i < 200 && !found.length; i++) {
        found = await offers();
        if (!found.length) await new Promise((r) => setTimeout(r, 25));
      }
      expect(found).toMatchObject([
        {
          from: 'work',
          title: 'Release notes',
          steps: 12,
          chat: { conversationId: convo.id },
          draft: {
            permissions: {
              capabilities: ['commands'],
              commands: ['git', 'grep', 'npm', 'wc', 'cat'].sort(),
            },
          },
        },
      ]);
      const offer = found[0] as SkillSuggestion;
      // Nothing was saved or turned on by Conch.
      expect((await services.skills.list()).skills).toEqual([]);

      const created = (await json(
        await app.inject({
          method: 'POST',
          url: '/api/skills',
          payload: { ...offer.draft, mode: 'manual', suggestion: offer.id },
        }),
      )) as { id: string; mode: string; permissions: { declared: boolean; commands?: string[] } };
      expect(created).toMatchObject({ mode: 'manual', permissions: { declared: true } });
      expect(await offers()).toEqual([]);
      const usage = JSON.parse(await readFile(join(home, 'skill-usage.json'), 'utf8'));
      expect(usage.from[created.id]).toMatchObject({ origin: 'learned' });

      // Using it by name is counted, as it's asked for (not once the answer is done).
      const finished = new Set<string>();
      const off = services.conversations.events.on((event) => {
        if (event.type === 'conversation.event' && event.event.type === 'turn.completed')
          finished.add(event.event.conversationId);
      });
      const used = await services.conversations.send({
        clientMessageId: 'use-it',
        text: `/${created.id} for 1.4`,
      });
      for (let i = 0; i < 100; i++) {
        const now = JSON.parse(await readFile(join(home, 'skill-usage.json'), 'utf8'));
        if (now.used[created.id]) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(
        JSON.parse(await readFile(join(home, 'skill-usage.json'), 'utf8')).used,
      ).toHaveProperty(created.id);
      await services.conversations.interrupt(used.id);
      // Stop requests cancellation; the completion event arrives after the final
      // writes. Don't remove the gateway's temporary home while they are in flight.
      await expect.poll(() => finished.has(used.id)).toBe(true);
      off();

      // The shelf is empty: it's new, and it was just used.
      expect(
        SkillShelf.parse(
          await json(await app.inject({ method: 'GET', url: '/api/skills/suggestions/shelf' })),
        ),
      ).toEqual({ stale: [], days: 60 });
      // Nothing on the shelf: a press changes nothing.
      expect(
        await json(
          await app.inject({
            method: 'POST',
            url: '/api/skills/suggestions/shelf',
            payload: { action: 'off', ids: [created.id] },
          }),
        ),
      ).toEqual({ changed: 0 });
      expect((await services.skills.detail(created.id)).mode).toBe('manual');
    },
  );

  it('a model that can’t write one well offers nothing; Don’t suggest this keeps it down', async () => {
    g = await gateway();
    const { app, services } = g;
    const bad = await chat(services, 'learn-fail: the release notes the long way');
    expect(await services.learner.consider(bad.id)).toMatchObject({ why: expect.any(String) });
    const good = await chat(services, 'Do the release notes the long way');
    const result = await services.learner.consider(good.id);
    const id = 'offered' in result ? result.offered.id : (await offers())[0]?.id;
    expect(id).toMatch(/^ws_/);
    await json(
      await app.inject({
        method: 'POST',
        url: '/api/skills/suggestions/dismiss',
        payload: { id, forever: true },
      }),
    );
    expect(await offers()).toEqual([]);
  });

  it('its files are backed up with your skills', () => {
    for (const file of ['skill-learned.json', 'skill-usage.json'])
      expect(classify(file)).toMatchObject({ class: 'kept', group: 'skills' });
  });
});

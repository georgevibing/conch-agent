/**
 * Stopping a chat's hold on a skill's list (ADR 0047), through the gateway:
 * a person in Conch can, a script's access key can't, and it's in the log.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function gateway(env: Record<string, string> = {}) {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-holds-'));
  const dir = join(home, 'skills', 'quick-setup');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    '---\nname: quick-setup\ndescription: Sets things up.\npermissions: commands:git\n---\n# Quick setup\n\nSet it up with git.\n',
  );
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      ...env,
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  closers.push(() => app.close());
  const done = new Promise<void>((resolve) => {
    const off = services.conversations.events.on((event: ServerEvent) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        off();
        resolve();
      }
    });
  });
  const chat = await services.conversations.send({ clientMessageId: 'u1', text: '/quick-setup' });
  await done;
  return { app, services, id: chat.id };
}

const url = (id: string, skill = 'quick-setup') =>
  `/api/conversations/${id}/skills/${skill}/stop-holding`;

describe('stop holding a chat to a skill’s list', () => {
  it('a person can, once; it’s in the log', async () => {
    const { app, services, id } = await gateway();
    expect(await services.conversations.holdsOf(id)).toMatchObject([
      { skillId: 'quick-setup', title: 'Quick setup', permissions: { commands: ['git'] } },
    ]);
    expect((await app.inject({ method: 'POST', url: url(id) })).statusCode).toBe(200);
    expect(await services.conversations.holdsOf(id)).toEqual([]);
    const { events } = await services.conversations.detail(id);
    expect(events.at(-1)).toMatchObject({ type: 'skill.hold.ended', reason: 'you' });
    // Not held any more, or never: it says so.
    const again = await app.inject({ method: 'POST', url: url(id) });
    expect(again.statusCode).toBe(404);
    expect(JSON.parse(again.body)).toMatchObject({
      message: 'This chat isn’t held to that skill.',
    });
  });

  it('a script with an access key can’t', async () => {
    const { app, services, id } = await gateway({ CONCH_TOKEN: 'a-very-long-secret-token' });
    const res = await app.inject({
      method: 'POST',
      url: url(id),
      headers: { authorization: 'Bearer a-very-long-secret-token' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'person-only' });
    expect(await services.conversations.holdsOf(id)).toHaveLength(1);
  });
});

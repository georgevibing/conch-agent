import { afterEach, describe, expect, it } from 'vitest';

import { MockDiscord } from './discord';

let discord: MockDiscord | undefined;
afterEach(async () => {
  await discord?.stop();
  discord = undefined;
});

async function commands(body: string, type: string) {
  discord = new MockDiscord();
  const base = await discord.start();
  return fetch(`${base}/api/v10/applications/${discord.bot.id}/commands`, {
    method: 'PUT',
    headers: { authorization: `Bot ${MockDiscord.TOKEN}`, 'content-type': type },
    body,
  });
}

describe('Discord fixture command registration', () => {
  it('refuses a body that is not a list of commands, and never sends it back', async () => {
    const attack = '<script>alert(document.domain)</script>';
    for (const [body, type] of [
      [attack, 'text/plain'],
      [JSON.stringify(attack), 'application/json'],
      [JSON.stringify([{ name: attack }]), 'application/json'],
    ] as const) {
      const response = await commands(body, type);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('<script');
      expect(discord?.commands).toEqual([]);
      await discord?.stop();
    }
  });

  it('keeps a list of commands and answers it as JSON', async () => {
    const list = [{ name: 'help', description: '<b>what Conch can do</b>' }];
    const response = await commands(JSON.stringify(list), 'application/json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual(list);
    expect(discord?.commands).toEqual(list);
  });
});

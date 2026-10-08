import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { A2aClient } from './client';
import { OutsideAgents, OutsideError } from './outside';

const HOST = 'https://203.0.113.5';
const KEY = 'cmcp.mcpc_peer.' + 'k'.repeat(43);
const card = {
  name: 'Sage at Ana’s',
  description: 'Plans trips',
  supportedInterfaces: [
    { url: `${HOST}/a2a/ag_sage`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
  ],
  securitySchemes: { conch: { type: 'http', scheme: 'bearer' } },
  skills: [{ name: 'Talk' }],
};

/** An agent elsewhere: its card behind a key, and an answer to every message. */
function elsewhere(state: { down?: boolean; seen: string[] }) {
  return new A2aClient((async (url: URL | string, init?: RequestInit) => {
    if (state.down) throw new TypeError('fetch failed');
    const auth = new Headers(init?.headers).get('authorization');
    state.seen.push(auth ?? '');
    if (auth !== `Bearer ${KEY}`) return new Response('{}', { status: 401 });
    if (String(url).endsWith('agent-card.json')) return Response.json(card);
    const body = JSON.parse(String(init?.body)) as { id: string };
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { message: { parts: [{ text: 'Hi!' }] } },
    });
  }) as unknown as typeof fetch);
}

async function setup(state: { down?: boolean; seen: string[] } = { seen: [] }) {
  const home = await mkdtemp(join(tmpdir(), 'conch-outside-'));
  return { home, state, outside: new OutsideAgents({ home, client: elsewhere(state) }) };
}

describe('outside agents', () => {
  it('asks for the key when the card is behind one, then adds it with one paste', async () => {
    const { outside, home } = await setup();
    await expect(outside.preview(`${HOST}/a2a/ag_sage`)).rejects.toMatchObject({
      code: 'needs-key',
    });
    const paste = `Address: ${HOST}/a2a/ag_sage\nKey: ${KEY}`;
    expect(await outside.preview(paste)).toMatchObject({
      name: 'Sage at Ana’s',
      keyed: true,
      needsKey: false,
    });
    const added = await outside.add(paste);
    expect(added).toMatchObject({ name: 'Sage at Ana’s', keyed: true, protocol: '1.0' });
    // The key is kept apart from the list, never in it.
    const list = await readFile(join(home, 'agents', 'outside.json'), 'utf8');
    expect(list).not.toContain(KEY);
    expect(await outside.preview(paste)).toMatchObject({ known: added.id });
  });

  it('adding it again replaces it, and removing it forgets its key', async () => {
    const { outside, state } = await setup();
    const paste = `${HOST}/a2a/ag_sage ${KEY}`;
    const first = await outside.add(paste);
    const again = await outside.add(paste);
    expect(again.id).toBe(first.id);
    expect(await outside.list()).toHaveLength(1);
    expect(
      (await outside.ask(first.id, { text: 'hi', signal: new AbortController().signal })).text,
    ).toBe('Hi!');
    expect(state.seen.at(-1)).toBe(`Bearer ${KEY}`);
    expect(await outside.keyed()).toHaveLength(1);
    expect(await outside.remove(first.id)).toBe(true);
    expect(await outside.keyed()).toHaveLength(0);
    expect(await outside.list()).toHaveLength(0);
  });

  it('remembers what went wrong, and Repair clears it once it answers again', async () => {
    const { outside, state } = await setup();
    const added = await outside.add(`${HOST}/a2a/ag_sage ${KEY}`);
    state.down = true;
    await expect(
      outside.ask(added.id, { text: 'hi', signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect((await outside.get(added.id))?.problem).toMatch(/Couldn’t reach/);
    expect(await outside.refresh(added.id)).toBe(false);
    state.down = false;
    expect(await outside.refresh(added.id)).toBe(true);
    expect((await outside.get(added.id))?.problem).toBeUndefined();
  });

  it('says what a paste is missing', async () => {
    const { outside } = await setup();
    await expect(outside.add('just my agent please')).rejects.toBeInstanceOf(OutsideError);
  });
});

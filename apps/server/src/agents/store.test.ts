import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AGENT_LIMITS, AgentList, FIRST_AGENT_ID, type Persona } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { SettingsStore } from '../settings/store';
import { carriesSecret, jpeg, png } from '../test/faces';
import { AgentError, AgentStore, uniqueName } from './store';

async function setup(persona?: Partial<Persona>) {
  const home = await mkdtemp(join(tmpdir(), 'conch-agents-'));
  const settings = new SettingsStore(home);
  if (persona) await settings.update({ persona });
  const heals: string[] = [];
  const lists: AgentList[] = [];
  const agents = new AgentStore(
    home,
    settings,
    (_area, message) => heals.push(message),
    (list) => lists.push(list),
  );
  return { home, settings, agents, heals, lists };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (error: unknown) => (error instanceof AgentError ? error.code : String(error)),
  );

describe('the first agent', () => {
  it('is the personality chosen at setup, so nothing changes for someone who never makes another', async () => {
    const { agents, home } = await setup({
      name: 'Shelly',
      tone: 'playful',
      instructions: 'Answer in British English.',
    });
    const list = await agents.list();
    expect(list.agents).toHaveLength(1);
    expect(list.defaultId).toBe(FIRST_AGENT_ID);
    expect(list.agents[0]).toMatchObject({
      id: FIRST_AGENT_ID,
      name: 'Shelly',
      persona: { tone: 'playful', personality: '' },
      instructions: 'Answer in British English.',
      avatar: { kind: 'preset', id: 'shell' },
      isDefault: true,
    });
    // Written down once, so a second Conch process reads the same agent.
    const file = JSON.parse(await readFile(join(home, 'agents', 'agents.json'), 'utf8'));
    expect(file.agents[0].id).toBe(FIRST_AGENT_ID);
    expect(AgentList.safeParse(list).success).toBe(true);
  });

  it('is called Conch on a new Conch', async () => {
    const { agents } = await setup();
    expect((await agents.default()).name).toBe('Conch');
  });

  it('is made again from the settings when the file is damaged, and says so quietly', async () => {
    const { agents, home, settings, heals } = await setup({ name: 'Shelly' });
    await agents.list();
    await writeFile(join(home, 'agents', 'agents.json'), '{ not json');
    const again = new AgentStore(home, settings, (_a, m) => heals.push(m));
    expect((await again.default()).name).toBe('Shelly');
    expect(heals.join(' ')).toMatch(/couldn’t be read/);
    const kept = await readdir(join(home, 'agents'));
    expect(kept.some((n) => n.includes('.broken-'))).toBe(true);
  });

  it('keeps the agents that still read when one is odd, and puts a default back', async () => {
    const { home, settings } = await setup();
    const dir = join(home, 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'agents.json'),
      JSON.stringify({
        version: 1,
        defaultId: 'ag_gone_away',
        agents: [
          { id: 'ag_sage01', name: 'Sage', persona: { tone: 'nonsense' }, order: 2 },
          { id: '../escape', name: 'Bad' },
          { id: 'ag_milo01', name: 'Milo', order: 1, avatar: { kind: 'image', id: 'nope' } },
        ],
      }),
    );
    const agents = new AgentStore(home, settings);
    const list = await agents.list();
    expect(list.agents.map((a) => a.name)).toEqual(['Milo', 'Sage']);
    expect(list.defaultId).toBe('ag_milo01');
    expect(list.agents[1]?.persona.tone).toBe('warm');
    expect(list.agents[0]?.avatar).toEqual({ kind: 'preset', id: 'shell' });
  });
});

describe('agents you make', () => {
  it('are made, changed and reordered, and every change is told', async () => {
    const { agents, lists } = await setup();
    const sage = await agents.create({
      name: 'Sage',
      role: 'Plans trips',
      persona: { tone: 'calm', personality: 'Dry humour' },
      instructions: 'Always give two options.',
      avatar: { kind: 'preset', id: 'owl', color: 'teal' },
    });
    expect(sage).toMatchObject({ name: 'Sage', isDefault: false, order: 1 });
    expect(lists.at(-1)?.agents.map((a) => a.name)).toEqual(['Conch', 'Sage']);

    const changed = await agents.update(sage.id, {
      persona: { personality: 'Warm humour' },
      defaults: { engine: 'mock', permissionMode: 'acceptEdits' },
    });
    expect(changed.persona).toEqual({ tone: 'calm', personality: 'Warm humour' });
    expect(changed.defaults).toEqual({ engine: 'mock', permissionMode: 'acceptEdits' });
    expect((await agents.update(sage.id, { defaults: null })).defaults).toBeUndefined();

    const order = await agents.reorder([sage.id, FIRST_AGENT_ID]);
    expect(order.agents.map((a) => a.name)).toEqual(['Sage', 'Conch']);
    expect(await code(agents.reorder([sage.id]))).toBe('bad-order');
    expect(await code(agents.reorder([sage.id, sage.id]))).toBe('bad-order');
  });

  it('have names of their own, whatever their case', async () => {
    const { agents } = await setup();
    await agents.create({ name: 'Sage' });
    expect(await code(agents.create({ name: ' sage ' }))).toBe('name-taken');
    expect(await code(agents.create({ name: 'conch' }))).toBe('name-taken');
    const milo = await agents.create({ name: 'Milo' });
    expect(await code(agents.update(milo.id, { name: 'SAGE' }))).toBe('name-taken');
    // Its own name in another case is fine.
    expect((await agents.update(milo.id, { name: 'MILO' })).name).toBe('MILO');
    expect(uniqueName('Sage', ['Sage', 'Sage 2'])).toBe('Sage 3');
    expect(uniqueName('x'.repeat(60), [])).toHaveLength(AGENT_LIMITS.name);
  });

  it('can’t carry Full trust, and are held to their limits', async () => {
    const { agents } = await setup();
    expect(
      await code(
        agents.create({
          name: 'Yolo',
          defaults: { permissionMode: 'bypassPermissions' as 'auto' },
        }),
      ),
    ).not.toBe('ok');
    expect(await code(agents.create({ name: 'Long', instructions: 'x'.repeat(8001) }))).not.toBe(
      'ok',
    );
    expect(await code(agents.create({ name: 'x'.repeat(41) }))).not.toBe('ok');
    for (let i = 1; i < AGENT_LIMITS.count; i++) await agents.create({ name: `A${i}` });
    expect(await code(agents.create({ name: 'One too many' }))).toBe('too-many');
  });

  it('the default moves when the default goes, and the last one stays', async () => {
    const { agents } = await setup();
    const sage = await agents.create({ name: 'Sage', isDefault: true });
    expect((await agents.list()).defaultId).toBe(sage.id);
    await agents.remove(sage.id);
    expect((await agents.list()).defaultId).toBe(FIRST_AGENT_ID);
    expect(await code(agents.remove(FIRST_AGENT_ID))).toBe('last');
    expect(await code(agents.remove('ag_never_was'))).toBe('not-found');
    expect(await code(agents.setDefault('ag_never_was'))).toBe('not-found');
  });

  it('finds a chat’s agent: its own, the first for a chat from before, else the default', async () => {
    const { agents } = await setup();
    const sage = await agents.create({ name: 'Sage', isDefault: true });
    expect((await agents.forChat({ agentId: sage.id })).name).toBe('Sage');
    expect((await agents.forChat({})).id).toBe(FIRST_AGENT_ID);
    await agents.setDefault(sage.id);
    const milo = await agents.create({ name: 'Milo' });
    await agents.remove(milo.id);
    expect((await agents.forChat({ agentId: milo.id })).id).toBe(sage.id);
  });
});

describe('the default agent and the settings from before agents', () => {
  it('writes the default agent back as a Conch from before agents reads it', async () => {
    const { agents, settings } = await setup();
    const sage = await agents.create({
      name: 'Sage',
      persona: { tone: 'candid' },
      instructions: 'y'.repeat(6000),
    });
    await agents.setDefault(sage.id);
    const { persona } = await settings.get();
    // The older Conch knows four tones and 4000 characters of instructions.
    expect(persona).toEqual({ name: 'Sage', tone: 'concise', instructions: 'y'.repeat(4000) });
    expect(await agents.persona()).toEqual({
      name: 'Sage',
      tone: 'candid',
      instructions: 'y'.repeat(6000),
    });
  });

  it('takes a change to the personality (setup, older Settings) as the default agent’s', async () => {
    const { agents } = await setup();
    await agents.create({ name: 'Sage' });
    const agent = await agents.adoptPersona({ name: 'Pearl', tone: 'formal' });
    expect(agent).toMatchObject({ id: FIRST_AGENT_ID, name: 'Pearl' });
    expect(agent.persona.tone).toBe('formal');
    expect(await code(agents.adoptPersona({ name: 'sage' }))).toBe('name-taken');
  });
});

describe('an agent’s own picture', () => {
  it('is kept without its metadata, served only as itself, and replaced cleanly', async () => {
    const { agents, home } = await setup();
    const sage = await agents.create({ name: 'Sage' });
    const first = await agents.setImage(sage.id, jpeg(64, { exif: true }).toString('base64'));
    if (first.avatar.kind !== 'image') throw new Error('no image');
    expect(first.avatar.url).toBe(`/api/agents/${sage.id}/avatar/${first.avatar.id}`);
    const read = await agents.image(sage.id, first.avatar.id);
    expect(read?.type).toBe('image/jpeg');
    expect(read && carriesSecret(read.bytes)).toBe(false);
    // Another agent's id, or an old picture's, finds nothing.
    expect(await agents.image(FIRST_AGENT_ID, first.avatar.id)).toBeUndefined();

    const second = await agents.setImage(sage.id, png(64).toString('base64'));
    if (second.avatar.kind !== 'image') throw new Error('no image');
    expect(await agents.image(sage.id, first.avatar.id)).toBeUndefined();
    expect(await readdir(join(home, 'agents', 'avatars'))).toEqual([`${second.avatar.id}.png`]);

    // Back to a preset lets the picture go.
    await agents.update(sage.id, { avatar: { kind: 'preset', id: 'fox' } });
    expect(await readdir(join(home, 'agents', 'avatars'))).toEqual([]);
  });

  it('refuses what isn’t a picture, and never writes one for an agent that isn’t there', async () => {
    const { agents, home } = await setup();
    const svg = Buffer.from('<svg onload="alert(1)"/>').toString('base64');
    expect(await code(agents.setImage(FIRST_AGENT_ID, svg))).toBe('bad-picture');
    expect(await code(agents.setImage(FIRST_AGENT_ID, 'not base64!'))).toBe('bad-picture');
    expect(await code(agents.setImage('ag_never_was', png(64).toString('base64')))).toBe(
      'not-found',
    );
    expect(await readdir(join(home, 'agents', 'avatars')).catch(() => [])).toEqual([]);
  });

  it('is never read through a link someone put in its place', async () => {
    const { agents, home } = await setup();
    const agent = await agents.setImage(FIRST_AGENT_ID, png(64).toString('base64'));
    if (agent.avatar.kind !== 'image') throw new Error('no image');
    const path = join(home, 'agents', 'avatars', `${agent.avatar.id}.png`);
    const secret = join(home, 'secrets.json');
    await writeFile(secret, '{"key":"sk-' + 'secret"}');
    await rm(path);
    await symlink(secret, path);
    expect(await agents.image(FIRST_AGENT_ID, agent.avatar.id)).toBeUndefined();
  });

  it('a missing picture goes back to a preset, and a stray one is let go, on Repair', async () => {
    const { agents, home } = await setup();
    const agent = await agents.setImage(FIRST_AGENT_ID, png(64).toString('base64'));
    if (agent.avatar.kind !== 'image') throw new Error('no image');
    const dir = join(home, 'agents', 'avatars');
    await rm(join(dir, `${agent.avatar.id}.png`));
    await writeFile(join(dir, 'im_stray0000.png'), png(64));
    expect(await agents.check(false)).toEqual({
      missing: [FIRST_AGENT_ID],
      strays: ['im_stray0000.png'],
    });
    await agents.check(true);
    expect((await agents.default()).avatar).toEqual({ kind: 'preset', id: 'shell' });
    expect(await readdir(dir)).toEqual([]);
    expect(await agents.check(false)).toEqual({ missing: [], strays: [] });
  });
});

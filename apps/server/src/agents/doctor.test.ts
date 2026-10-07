import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FIRST_AGENT_ID } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { DoctorCheck } from '../doctor/service';
import { SettingsStore } from '../settings/store';
import { png } from '../test/faces';
import { registerAgentsDoctor } from './doctor';
import { AgentStore } from './store';

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-agents-doctor-'));
  const agents = new AgentStore(home, new SettingsStore(home));
  let check: DoctorCheck | undefined;
  registerAgentsDoctor({ register: (c: DoctorCheck) => (check = c) } as never, agents);
  const run = async (repair: boolean) =>
    (await check?.run({ repair, signal: new AbortController().signal }))?.[0];
  return { home, agents, run };
}

describe('Repair everything, for agents', () => {
  it('says they’re ready when they are', async () => {
    const { run } = await setup();
    expect(await run(false)).toMatchObject({ state: 'ok', message: 'Your agent is ready.' });
  });

  it('gives an agent whose picture went one of Conch’s, and says so', async () => {
    const { home, agents, run } = await setup();
    const agent = await agents.setImage(FIRST_AGENT_ID, png(64).toString('base64'));
    if (agent.avatar.kind !== 'image') throw new Error('no image');
    await rm(join(home, 'agents', 'avatars', `${agent.avatar.id}.png`));
    await writeFile(join(home, 'agents', 'avatars', 'im_stray0000.png'), png(64));
    expect(await run(false)).toMatchObject({ state: 'warning' });
    expect(await run(true)).toMatchObject({
      state: 'fixed',
      message: expect.stringMatching(/gave it one of its own/),
    });
    expect((await agents.default()).avatar.kind).toBe('preset');
    expect(await run(false)).toMatchObject({ state: 'ok' });
  });
});

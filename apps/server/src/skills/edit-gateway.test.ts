import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ToolView, describeTool } from '@conch/protocol';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';
import { taintFrom } from '../conversations/taint';
import { skillEditTools } from './edit-tools';

it('reviews in chat, saves through the authenticated skill route, and refuses replay', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-skill-gateway-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  try {
    await services.skills.create({
      name: 'preview',
      title: 'Preview',
      description: 'Start a preview.',
      instructions: 'Use clawapp.',
      mode: 'manual',
    });
    const tools = services.skills.tools({ conversationId: 'test', append: () => undefined });
    const inspect = tools.find((tool) => tool.name === 'inspect_skill');
    const edit = tools.find((tool) => tool.name === 'edit_skill');
    if (!inspect || !edit) throw new Error('Skill tools missing');
    const read = JSON.parse(String(await inspect.run({ name: 'preview' }))) as {
      expected_hash: string;
    };
    const proposal = await edit.run({
      name: 'preview',
      expected_hash: read.expected_hash,
      instructions: 'Use devapps.',
      summary: 'Switch preview tools.',
    });
    if (typeof proposal === 'string') throw new Error(proposal);
    const view = ToolView.parse(proposal.view);
    if (view.kind !== 'skill-update') throw new Error('Wrong card');
    expect((await app.inject('/api/skills/preview')).json().instructions).toBe('Use clawapp.');
    const save = () =>
      app.inject({
        method: 'PATCH',
        url: '/api/skills/preview',
        payload: { instructions: view.instructions, expectedHash: view.expectedHash },
      });
    expect((await save()).json()).toMatchObject({ instructions: 'Use devapps.', mode: 'manual' });
    const replay = await save();
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
    expect(replay.json().message).toContain('changed');
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/skills/preview',
          payload: { instructions: 'bad', expectedHash: 'not-a-hash' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      skillEditTools(services.skills.store, { unattended: true }).map((tool) => tool.name),
    ).toEqual(['inspect_skill']);
    expect(
      skillEditTools(services.skills.store, { origin: { kind: 'routine' } }).map(
        (tool) => tool.name,
      ),
    ).toEqual(['inspect_skill']);
    expect(describeTool('edit_skill', {})).toMatchObject({
      doing: 'Proposing a skill update',
      done: 'Proposed a skill update',
    });
    expect(taintFrom('inspect_skill', {})).toMatchObject({ kind: 'app' });
  } finally {
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});

/**
 * What a task may do, end to end (ADR 0033): the real gateway with the mock
 * engine, which calls Conch's tools the bridged way, as every provider whose
 * hands are Conch's does. A task gets its chat's everyday tools — otherwise a
 * task on a model API could do nothing at all — but never the ones that would
 * let it hand work on out of sight or give itself a future.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { TurnInput } from '../engines/types';
import { Services } from '../services';
import { onThisComputer } from '../test/here';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const services = new Services(
    loadConfig({
      CONCH_HOME: await mkdtemp(join(tmpdir(), 'conch-task-powers-')),
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  open.push(app);
  await app.ready();
  await services.recovery.start(async () => (await app.inject('/api/health')).statusCode === 200);
  const engine = services.engines.get('mock');
  if (!engine) throw new Error('no mock engine');
  const turns: TurnInput[] = [];
  const runTurn = engine.runTurn.bind(engine);
  vi.spyOn(engine, 'runTurn').mockImplementation((input) => {
    turns.push(input);
    return runTurn(input);
  });
  return { services, turns };
}

describe('a task’s tools', () => {
  it('are its chat’s everyday ones, without handing work on or scheduling a future', async () => {
    const { services, turns } = await setup();
    const task = await services.tasks.create({ kind: 'background', text: 'Tidy the README' });
    for (let i = 0; i < 400; i++) {
      const now = await services.tasks.get(task.id);
      if (!['queued', 'running'].includes(now.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const turn = turns.at(-1);
    const names = turn?.tools.map((t) => t.name) ?? [];
    // What it needs to do the work at all, whoever answers.
    expect(names).toEqual(
      expect.arrayContaining(['report_result', 'read_file', 'publish_file', 'process_start']),
    );
    // One level, and no future of its own: nobody is watching either of those.
    for (const forbidden of [
      'delegate',
      'start_background_task',
      'create_routine',
      'update_routine',
      'delete_routine',
      'search_chats',
      'read_chat',
      'ask',
      'offer',
    ])
      expect(names).not.toContain(forbidden);
    // Told how it stands, so it reports back rather than asking anyone.
    expect(turn?.systemAppend).toContain('report_result');
  });
});

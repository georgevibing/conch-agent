import { taskExpectations } from './service';
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
import { buildTools } from '../engines/api/engine';
import { assessTask } from '@conch/protocol';
import type { EngineEvent, TurnInput } from '../engines/types';
import { Services } from '../services';
import { resourcePolicy } from '../recovery/resources';
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
  // This fixture tests task tools, not the shared runner's load. Keep admission
  // deterministic, as the mock browser journeys do; recovery has its own tests.
  vi.spyOn(services.processes, 'readResources').mockResolvedValue(
    resourcePolicy({
      at: Date.now(),
      totalBytes: 8 * 1024 ** 3,
      availableBytes: 6 * 1024 ** 3,
      cpuCount: 4,
      loadPerCpu: 0,
      memoryPressure: 0,
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  open.push(app);
  await app.ready();
  await services.recovery.start(async () => (await app.inject('/api/health')).statusCode === 200);
  expect(services.recovery.allowsWork).toBe(true);
  const engine = services.engines.get('mock');
  if (!engine) throw new Error('no mock engine');
  const turns: TurnInput[] = [];
  const runTurn = engine.runTurn.bind(engine);
  vi.spyOn(engine, 'runTurn').mockImplementation((input) => {
    turns.push(input);
    return runTurn(input);
  });
  return { services, turns, engine };
}

describe('a task’s tools', () => {
  it('runs the complete diagnostic through the gateway, its task wrappers and real tools', async () => {
    const { services, engine } = await setup();
    const parent = await services.conversations.send({
      clientMessageId: 'parent',
      text: 'Hello',
      options: { permissionMode: 'bypassPermissions' },
    });
    for (let i = 0; i < 400; i++) {
      if ((await services.conversations.detail(parent.id)).conversation.status === 'idle') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    vi.spyOn(engine, 'runTurn').mockImplementation(
      async function* (input): AsyncIterable<EngineEvent> {
        const tools = buildTools(input);
        const steps: [string, Record<string, unknown>][] = [
          ['Read', { file_path: 'missing-on-purpose.txt' }],
          ['Write', { file_path: 'probe.txt', content: 'initial' }],
          ['Edit', { file_path: 'probe.txt', old_string: 'initial', new_string: 'updated' }],
          ['Read', { file_path: 'probe.txt' }],
          ['Write', { file_path: 'probe.txt', content: 'final' }],
          ['mcp__conch__current_time', {}],
          [
            'mcp__conch__artifact_create',
            { kind: 'markdown', title: 'Probe', content: 'Initial report' },
          ],
        ];
        for (const [index, [name, args]] of steps.entries()) {
          const tool = tools.get(name);
          if (!tool) throw new Error(`Missing ${name}`);
          const id = `call_${index}`;
          yield { type: 'tool-start', name: tool.display, toolUseId: id, input: args };
          const result = await tool.run(args, id);
          expect(result.isError).toBe(index === 0);
          if (name === 'Read' && index > 0) expect(result.text).toBe('updated');
          yield {
            type: 'tool-end',
            toolUseId: id,
            status: result.isError ? 'error' : 'success',
            output: result.text,
          };
        }
        await tools
          .get('mcp__conch__report_result')
          ?.run({ summary: 'Expected read failure recovered; file and artifact saved.' }, 'report');
        yield { type: 'done', outcome: 'success' };
      },
    );
    const task = await services.tasks.create({
      kind: 'background',
      text: 'Run the diagnostic',
      expectations: taskExpectations([
        { tool: 'Write', minimum: 1, arguments: { file_path: 'probe.txt', content: 'final' } },
        { tool: 'Edit', minimum: 1 },
        { tool: 'Read', minimum: 1 },
        { tool: 'artifact_create', minimum: 1 },
        { tool: 'current_time', minimum: 1 },
      ]),
      parentConversationId: parent.id,
    });
    const [done] = await services.tasks.waitFor([task.id]);
    expect(done).toMatchObject({ status: 'done', verification: 'verified', modelCompleted: true });
    expect(done?.error).toBeUndefined();
    if (!done) throw new Error('No task result');
    expect(assessTask(done).verdict).toBe('verified');
    expect(assessTask(done).failedReads).toBe(1);
    expect(done.operations?.[0]).toMatchObject({
      tool: 'Read',
      state: 'not-run',
      execution: 'failed',
    });
    expect(done.operations?.slice(1).every((op) => op.state === 'confirmed')).toBe(true);
    expect(done.operations?.map((op) => op.tool)).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'Read', 'artifact_create', 'current_time']),
    );
    expect(
      assessTask({
        ...done,
        expectations: [
          { tool: 'Write', minimum: 1 },
          { tool: 'Edit', minimum: 1 },
          { tool: 'artifact_create', minimum: 1 },
        ],
      }).verdict,
    ).toBe('verified');
  });
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

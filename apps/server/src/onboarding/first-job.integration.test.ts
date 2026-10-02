import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { FirstJobRequest } from '@conch/protocol';
import { ArtifactService } from '../artifacts/service';
import { ArtifactStore } from '../artifacts/store';
import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import { MockEngine } from '../engines/mock/engine';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { TaskService } from '../tasks/service';
import { TaskStore } from '../tasks/store';
import { FirstJobService } from './first-job';

describe('first job through the real task and artifact services', () => {
  it('delivers one verified document with durable receipts, and recovers the same job', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-first-job-'));
    const settings = new SettingsStore(home);
    await settings.update({ preferences: { engine: 'mock', autoTitle: false } });
    const engine = new MockEngine({ speed: 0 });
    const forbidden = vi.fn();
    const artifacts: ArtifactService = new ArtifactService({
      store: new ArtifactStore(home),
      conversations: () => conversations,
      emit: () => undefined,
    });
    const conversations: ConversationManager = new ConversationManager({
      store: new ConversationStore(join(home, 'conversations')),
      settings,
      memory: new MemoryStore(join(home, 'memory')),
      engine: () => engine,
      tools: (ctx) => [
        ...artifacts.tools(ctx),
        {
          name: 'unapproved_external_action',
          description: 'Must not be exposed',
          input: {},
          run: forbidden,
        },
      ],
    });
    const tasks = new TaskService({
      store: new TaskStore(home),
      conversations,
      settings,
      engine: () => engine,
      home,
      emit: () => undefined,
    });
    conversations.events.on((event) => tasks.onEvent(event));
    await tasks.start();
    const jobs = new FirstJobService({
      tasks,
      providers: { load: async () => 'mock', engineFor: () => engine },
      google: { status: async () => ({ accounts: [] }) },
    });
    const input = FirstJobRequest.parse({
      requestId: 'real_first_job_request',
      kind: 'document',
      engine: 'mock',
      model: 'default',
      source: 'Maya owns the launch checklist. Deadline Friday.',
    });
    const created = await jobs.start(input);
    await vi.waitUntil(
      async () => ['done', 'unverified', 'failed'].includes((await tasks.get(created.id)).status),
      { timeout: 8000 },
    );
    const result = await tasks.get(created.id);
    expect(result.status).toBe('done');
    expect(result.verification).toBe('verified');
    expect(result.operations).toHaveLength(1);
    expect(result.operations?.[0]).toMatchObject({
      tool: 'artifact_create',
      state: 'confirmed',
      receipt: { provider: 'Conch' },
    });
    const receipt = result.operations?.[0]?.receipt;
    if (!receipt) throw new Error('Verified artifact receipt missing');
    expect((await artifacts.store.content(receipt.id)).content).toContain(
      'Maya owns the launch checklist',
    );
    expect(forbidden).not.toHaveBeenCalled();
    expect((await jobs.start(input)).id).toBe(created.id);
    expect((await jobs.latest()).task?.id).toBe(created.id);
    expect(await new ArtifactStore(home).list()).toHaveLength(1);
    expect((await new TaskStore(home).get(created.id))?.operations).toEqual(result.operations);
  });
});

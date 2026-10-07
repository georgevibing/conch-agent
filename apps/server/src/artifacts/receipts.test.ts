import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '@conch/protocol';
import type { ConversationManager } from '../conversations/manager';

import { TaskOperations } from '../tasks/operations';
import type { Task } from '@conch/protocol';
import { LiveDataAccess } from './live';
import { ArtifactService } from './service';
import { artifactOperationId, ArtifactStore } from './store';

describe('artifact completion receipts', () => {
  it('updates an artifact with durable version evidence and recovers without another version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifact-update-'));
    const store = new ArtifactStore(home);
    const service = new ArtifactService({
      store,
      conversations: () => {
        throw new Error('not needed');
      },
      emit: () => undefined,
      access: new LiveDataAccess(home),
      gatewayPort: 4317,
    });
    const artifact = await store.create({
      title: 'Report',
      kind: 'markdown',
      content: 'one',
      conversationId: 'c_test',
    });
    let task: Task = {
      id: 'task',
      title: 'Update',
      prompt: 'Update',
      kind: 'background',
      status: 'running',
      options: {},
      createdAt: 1,
      rev: 0,
      steps: [],
      operations: [],
    };
    const ledger = () =>
      new TaskOperations(
        async () => task,
        async (change) => (task = { ...task, ...change(task) }),
        () => false,
      );
    const update = service
      .tools({ conversationId: 'c_test', append: () => undefined })
      .find((tool) => tool.name === 'artifact_update');
    if (!update) throw new Error('Missing update');
    await ledger().wrap(update).run({ id: artifact.id, content: 'two' });
    expect(task.operations?.[0]?.state).toBe('confirmed');
    // A restart loses in-memory state but the checkpoint can read back the exact version.
    task = { ...task, operations: task.operations?.map((op) => ({ ...op, state: 'running' })) };
    await ledger().wrap(update).run({ id: artifact.id, content: 'two' });
    expect((await store.get(artifact.id)).versions).toHaveLength(2);
    await ledger().wrap(update).run({ id: artifact.id, content: 'three' });
    expect((await store.content(artifact.id)).content).toBe('three');
    expect((await store.get(artifact.id)).versions).toHaveLength(3);
    expect(task.operations?.every((op) => op.state === 'confirmed')).toBe(true);
  });
  it('distinguishes rejected content from an uncertain write', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifact-preflight-'));
    const store = new ArtifactStore(home);
    const service = new ArtifactService({
      store,
      conversations: () => {
        throw new Error('No IO should start');
      },
      emit: () => undefined,
      access: new LiveDataAccess(home),
      gatewayPort: 4317,
    });
    const tool = service
      .tools({ conversationId: 'c_test', append: () => undefined })
      .find((tool) => tool.name === 'artifact_create');
    if (!tool) throw new Error('Artifact tool missing');
    expect(
      await tool.run(
        { title: 'Bad chart', kind: 'chart', content: 'not JSON' },
        { operationId: 'op_invalid' },
      ),
    ).toMatchObject({ effect: 'not-executed' });
    expect(await store.list()).toEqual([]);
  });

  it('cannot bypass a task’s saved scope or operation ledger with a fenced reply', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifact-scope-'));
    const store = new ArtifactStore(home);
    const eventsAfter = vi.fn().mockResolvedValue([
      {
        type: 'assistant.delta',
        kind: 'text',
        delta: '```artifact kind="markdown" title="Unapproved"\nBypass\n```',
      },
    ]);
    const manager = {
      detail: async () => ({ conversation: { origin: { kind: 'task', taskId: 'task_test' } } }),
      eventsAfter,
    } as unknown as ConversationManager;
    const service = new ArtifactService({
      store,
      conversations: () => manager,
      emit: () => undefined,
      access: new LiveDataAccess(home),
      gatewayPort: 4317,
    });
    await service.onEvent({
      type: 'conversation.event',
      event: { type: 'turn.completed', conversationId: 'c_task' },
    } as ServerEvent);
    expect(eventsAfter).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it('saves one durable artifact for an operation, even after a restart and duplicate invocation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifact-receipt-'));
    const first = new ArtifactStore(home);
    const input = {
      title: 'My brief',
      kind: 'markdown' as const,
      content: '# Verified brief',
      conversationId: 'c_test',
      operationId: 'op_saved',
    };
    const [a, b] = await Promise.all([first.create(input), first.create(input)]);
    expect(a.id).toBe(b.id);
    const restarted = new ArtifactStore(home);
    expect((await restarted.create(input)).id).toBe(a.id);
    expect(await restarted.list()).toHaveLength(1);
    expect((await restarted.content(a.id)).content).toBe(input.content);
    await expect(restarted.create({ ...input, content: 'Different content' })).rejects.toThrow(
      'different document',
    );
  });

  it('verifies actual saved bytes, not the model summary, and does not confirm a mismatched output', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifact-proof-'));
    const store = new ArtifactStore(home);
    const service = new ArtifactService({
      store,
      conversations: () => {
        throw new Error('Not called during readback');
      },
      emit: () => undefined,
      access: new LiveDataAccess(home),
      gatewayPort: 4317,
    });
    const tool = service
      .tools({ conversationId: 'c_test', append: () => undefined })
      .find((tool) => tool.name === 'artifact_create');
    if (!tool) throw new Error('Artifact tool missing');
    const args = { title: 'Brief', kind: 'markdown', content: '# Fact checked' };
    expect(await tool.verification?.reconcile(args, 'op_test')).toEqual({ state: 'absent' });
    await store.create({
      ...args,
      kind: 'markdown',
      conversationId: 'c_test',
      operationId: 'op_test',
    });
    expect(await tool.verification?.reconcile(args, 'op_test')).toMatchObject({
      state: 'confirmed',
      receipt: { provider: 'Conch', id: artifactOperationId('c_test', 'op_test') },
    });
    const id = artifactOperationId('c_test', 'op_test');
    await writeFile(join(home, 'artifacts', id, 'v1.md'), 'tampered');
    expect(await tool.verification?.reconcile(args, 'op_test')).toEqual({ state: 'unknown' });
  });
});

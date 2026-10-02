import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Task } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { HostTool } from '../engines/types';
import { taskArgumentHash, TaskOperations, verifiedOutcome } from './operations';
import { mergeTaskLedgers, TaskStore } from './store';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-ledger-'));
  let store = new TaskStore(home);
  await store.save({
    id: 'task_1',
    title: 'Save a draft',
    prompt: 'Draft only, never send',
    kind: 'background',
    status: 'running',
    options: {},
    steps: [],
    rev: 0,
    createdAt: 1,
    expectations: [{ tool: 'draft', minimum: 1 }],
    operations: [],
  });
  let stopped = false;
  const ledger = () =>
    new TaskOperations(
      async () => required(await store.get('task_1')),
      async (change) => {
        const task = required(await store.get('task_1'));
        return store.save({ ...task, ...change(task) });
      },
      () => stopped,
      () => 100,
    );
  let account = 'account_1';
  let authorization = 'consent_1';
  let expiresAt = 1000;
  let providerEffect = false;
  let canRead = true;
  const tool: HostTool = {
    name: 'draft',
    description: 'Save draft',
    input: {},
    run: vi.fn(async (_args, context) => {
      expect(context?.operationId).toMatch(/^op_/);
      const disk = JSON.parse(await readFile(join(home, 'tasks.json'), 'utf8')) as {
        tasks: Task[];
      };
      expect(disk.tasks[0]?.operations?.find((op) => op.id === context?.operationId)?.state).toBe(
        'running',
      );
      providerEffect = true;
      return 'Saved; nothing sent.';
    }),
    verification: {
      effect: 'write',
      scope: async () => ({ account, authorization, expiresAt }),
      reconcile: vi.fn(async () =>
        canRead && providerEffect
          ? {
              state: 'confirmed' as const,
              receipt: {
                provider: 'mail',
                id: 'draft_1',
                label: 'Saved draft — nothing sent',
                url: 'https://mail.example/draft_1',
              },
            }
          : { state: 'unknown' as const },
      ),
    },
  };
  return {
    home,
    tool,
    ledger,
    get: async () => required(await store.get('task_1')),
    update: async (patch: Partial<Task>) =>
      store.save({ ...required(await store.get('task_1')), ...patch }),
    restart: () => {
      store = new TaskStore(home);
    },
    stop: () => {
      stopped = true;
    },
    account: () => {
      account = 'other';
    },
    consent: () => {
      authorization = 'consent_2';
    },
    expire: () => {
      expiresAt = 99;
    },
    unreadable: () => {
      canRead = false;
    },
    readable: () => {
      canRead = true;
    },
  };
}

describe('durable task operations', () => {
  it('writes intent before effect; duplicate concurrent calls and retries do not repeat it', async () => {
    const f = await setup();
    const wrapped = f.ledger().wrap(f.tool);
    await Promise.all([wrapped.run({}), wrapped.run({}), wrapped.run({})]);
    f.restart();
    await f.ledger().wrap(f.tool).run({});
    expect(f.tool.run).toHaveBeenCalledTimes(1);
    expect(verifiedOutcome(await f.get())).toBe(true);
    expect((await f.get()).operations?.[0]?.receipt?.label).toMatch(/nothing sent/);
  });

  it('restart after a provider write but before recording receipt recovers without another write', async () => {
    const f = await setup();
    f.unreadable();
    await f.ledger().wrap(f.tool).run({});
    const task = await f.get();
    // Crash can leave running instead of unresolved; both must reconcile before reissue.
    required(task.operations?.[0]).state = 'running';
    await writeFile(join(f.home, 'tasks.json'), JSON.stringify({ tasks: [task] }));
    f.restart();
    f.readable();
    await f.ledger().wrap(f.tool).run({});
    await f.ledger().wrap(f.tool).run({});
    expect(f.tool.run).toHaveBeenCalledTimes(1);
    expect(verifiedOutcome(await f.get())).toBe(true);
  });

  it('does not retry ambiguous writes, even when a search reports absent', async () => {
    const f = await setup();
    f.unreadable();
    await f.ledger().wrap(f.tool).run({});
    f.restart();
    required(f.tool.verification).reconcile = async () => ({ state: 'absent' });
    await expect(f.ledger().wrap(f.tool).run({})).rejects.toThrow(/may already have happened/);
    await expect(f.ledger().wrap(f.tool).run({})).rejects.toThrow(/may already have happened/);
    expect(f.tool.run).toHaveBeenCalledTimes(1);
    expect(verifiedOutcome(await f.get())).toBe(false);
  });

  it.each(['account', 'expire'] as const)(
    'does not reuse evidence or approvals after %s changes',
    async (change) => {
      const f = await setup();
      await f.ledger().wrap(f.tool).run({});
      f[change]();
      await expect(f.ledger().wrap(f.tool).run({})).rejects.toThrow(/changed|expired/);
      expect(f.tool.run).toHaveBeenCalledTimes(1);
    },
  );

  it('same-account reconnect can reconcile confirmed and uncertain writes, never replay them', async () => {
    const f = await setup();
    f.unreadable();
    await f.ledger().wrap(f.tool).run({});
    f.consent();
    f.readable();
    await f.ledger().wrap(f.tool).run({});
    await f.ledger().wrap(f.tool).run({});
    expect(f.tool.run).toHaveBeenCalledTimes(1);
    expect((await f.get()).operations?.[0]?.state).toBe('confirmed');
  });

  it('same-account reconnect can reread and obtain fresh approval for a proven unattempted write', async () => {
    const f = await setup();
    const original = f.tool.run;
    f.tool.run = vi
      .fn<HostTool['run']>()
      .mockResolvedValueOnce({ text: 'Declined', effect: 'not-executed' })
      .mockImplementation(original);
    await f.ledger().wrap(f.tool).run({});
    f.consent();
    await f.ledger().wrap(f.tool).run({});
    expect(original).toHaveBeenCalledTimes(1);
    expect((await f.get()).operations?.[0]?.authorization).toBe('consent_2');
    const read = await setup();
    required(read.tool.verification).effect = 'read';
    await read.ledger().wrap(read.tool).run({});
    read.consent();
    await read.ledger().wrap(read.tool).run({});
    expect(read.tool.run).toHaveBeenCalledTimes(2);
  });

  it('keeps a confirmed partial result when another action fails', async () => {
    const f = await setup();
    await f.ledger().wrap(f.tool).run({});
    const other = {
      ...f.tool,
      name: 'second',
      run: async () => {
        throw new Error('timeout');
      },
      verification: undefined,
    };
    await expect(f.ledger().wrap(other).run({})).rejects.toThrow('timeout');
    expect((await f.get()).operations?.map((op) => op.state)).toEqual(['confirmed', 'unresolved']);
    expect(verifiedOutcome(await f.get())).toBe(false);
  });

  it('stop blocks effects and does not discard a result already confirmed', async () => {
    const f = await setup();
    await f.ledger().wrap(f.tool).run({});
    f.stop();
    await expect(f.ledger().wrap(f.tool).run({ other: true })).rejects.toThrow(/stopped/);
    expect((await f.get()).operations?.[0]?.state).toBe('confirmed');
    expect(f.tool.run).toHaveBeenCalledTimes(1);
  });

  it('unknown native tools are tracked and never replayed under a new call id', async () => {
    const f = await setup();
    expect(await f.ledger().beforeNative('Bash', { command: 'write something' })).toBeUndefined();
    f.restart();
    expect(await f.ledger().beforeNative('Bash', { command: 'write something' })).toMatch(
      /may already/,
    );
    expect(verifiedOutcome(await f.get())).toBe(false);
  });

  it('model completion and satisfied subsets cannot certify the whole goal', async () => {
    const f = await setup();
    expect(verifiedOutcome({ ...(await f.get()), modelCompleted: true })).toBe(false);
    await f.ledger().wrap(f.tool).run({});
    expect(
      verifiedOutcome({ ...(await f.get()), expectations: [{ tool: 'draft', minimum: 2 }] }),
    ).toBe(false);
    expect(verifiedOutcome({ ...(await f.get()), expectations: undefined })).toBe(false);
  });

  it('a trusted not-executed result permits a fresh attempt, unlike an ambiguous write', async () => {
    const f = await setup();
    const original = f.tool.run;
    f.tool.run = vi
      .fn<HostTool['run']>()
      .mockResolvedValueOnce({
        text: 'Approval declined; no write attempted.',
        effect: 'not-executed',
      })
      .mockImplementation(original);
    await f.ledger().wrap(f.tool).run({});
    expect((await f.get()).operations?.[0]?.state).toBe('not-run');
    expect(original).not.toHaveBeenCalled();
    f.restart();
    await f.ledger().wrap(f.tool).run({});
    expect(original).toHaveBeenCalledTimes(1);
    expect((await f.get()).operations?.[0]?.state).toBe('confirmed');
  });

  it('optional declined writes do not block confirmed work, but required or ambiguous writes do', async () => {
    const f = await setup();
    await f.update({ expectations: [{ tool: 'artifact_create', minimum: 1 }] });
    await f
      .ledger()
      .wrap({ ...f.tool, name: 'artifact_create' })
      .run({});
    f.tool.run = vi.fn(async () => ({
      text: 'Approval declined; nothing saved.',
      effect: 'not-executed' as const,
    }));
    await f.ledger().wrap(f.tool).run({});
    f.restart();
    const task = await f.get();
    expect(task.operations?.map((op) => op.state)).toEqual(['confirmed', 'not-run']);
    expect(verifiedOutcome(task)).toBe(true);
    expect(
      verifiedOutcome({
        ...task,
        expectations: [...(task.expectations ?? []), { tool: 'draft', minimum: 1 }],
      }),
    ).toBe(false);
    for (const state of ['running', 'unresolved'] as const) {
      expect(
        verifiedOutcome({
          ...task,
          operations: task.operations?.map((op) => (op.tool === 'draft' ? { ...op, state } : op)),
        }),
      ).toBe(false);
    }
  });

  it('per-tool write limits bound effects, including concurrent different arguments', async () => {
    const f = await setup();
    await f.update({ toolScope: { names: ['draft'], limits: { draft: 1 } } });
    const wrapped = f.ledger().wrap(f.tool);
    const attempts = await Promise.allSettled([
      wrapped.run({ body: 'one' }),
      wrapped.run({ body: 'two' }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.tool.run).toHaveBeenCalledTimes(1);
    await wrapped.run({ body: 'one' });
    expect(f.tool.run).toHaveBeenCalledTimes(1);
  });

  it('fixed draft arguments accept reordered optional fields but reject any content or recipient change', async () => {
    const f = await setup();
    const args = {
      accountId: 'account_1',
      to: ['person@example.com'],
      subject: 'Hello',
      body: 'Prepared text',
      threadId: undefined,
    };
    await f.update({
      toolScope: { names: ['draft'], argumentHashes: { draft: taskArgumentHash(args) } },
    });
    expect(
      taskArgumentHash({
        body: 'Prepared text',
        subject: 'Hello',
        to: ['person@example.com'],
        accountId: 'account_1',
      }),
    ).toBe(taskArgumentHash(args));
    await expect(
      f
        .ledger()
        .wrap(f.tool)
        .run({ ...args, body: 'Changed' }),
    ).rejects.toThrow(/exact draft/);
    expect(f.tool.run).not.toHaveBeenCalled();
    await f.ledger().wrap(f.tool).run(args);
    expect(f.tool.run).toHaveBeenCalledTimes(1);
  });

  it('semantic write identity binds its original content, not just the invocation id', async () => {
    const f = await setup();
    required(f.tool.verification).identity = () => 'thread_1';
    await f.ledger().wrap(f.tool).run({ body: 'First draft' });
    await expect(f.ledger().wrap(f.tool).run({ body: 'Regenerated text' })).rejects.toThrow(
      /contents.*changed/,
    );
    expect(f.tool.run).toHaveBeenCalledTimes(1);
  });

  it('changed arguments cannot bypass an unresolved write', async () => {
    const f = await setup();
    f.unreadable();
    await f.ledger().wrap(f.tool).run({ body: 'First draft' });
    await expect(f.ledger().wrap(f.tool).run({ body: 'Regenerated text' })).rejects.toThrow(
      /may already/,
    );
    expect(f.tool.run).toHaveBeenCalledTimes(1);
  });

  it('backup restore preserves newer receipts and tombstones, and requires reconciliation', async () => {
    const f = await setup();
    const backup = Buffer.from(JSON.stringify({ tasks: [await f.get()] }));
    await f.ledger().wrap(f.tool).run({});
    const current = { ...(await f.get()), archivedAt: 150, requestKey: 'original-click' };
    const restored = mergeTaskLedgers(Buffer.from(JSON.stringify({ tasks: [current] })), backup);
    const parsed = JSON.parse(restored.toString()) as { tasks: Task[] };
    expect(parsed.tasks[0]).toMatchObject({
      archivedAt: 150,
      requestKey: 'original-click',
      restored: true,
    });
    expect(parsed.tasks[0]?.operations?.[0]).toMatchObject({
      state: 'unresolved',
      receipt: { id: 'draft_1' },
    });
    await writeFile(join(f.home, 'tasks.json'), restored);
    f.restart();
    await f.ledger().wrap(f.tool).run({});
    expect(f.tool.run).toHaveBeenCalledTimes(1);
    expect((await f.get()).operations?.[0]?.state).toBe('confirmed');
    await expect(f.ledger().wrap(f.tool).run({ newAction: true })).rejects.toThrow(
      /historical backup/,
    );
  });

  it('a historical backup with no receipt cannot prove an external write never happened', async () => {
    const f = await setup();
    const restored = mergeTaskLedgers(
      undefined,
      Buffer.from(JSON.stringify({ tasks: [await f.get()] })),
    );
    await writeFile(join(f.home, 'tasks.json'), restored);
    f.restart();
    await expect(f.ledger().wrap(f.tool).run({})).rejects.toThrow(/historical backup/);
    expect(f.tool.run).not.toHaveBeenCalled();
  });

  it('safe read replay returns actual contents and refreshes current-goal evidence', async () => {
    const f = await setup();
    required(f.tool.verification).effect = 'read';
    const wrapped = f.ledger().wrap(f.tool);
    expect(await wrapped.run({})).toBe('Saved; nothing sent.');
    expect(await wrapped.run({})).toBe('Saved; nothing sent.');
    expect(f.tool.run).toHaveBeenCalledTimes(2);
    expect(verifiedOutcome({ ...(await f.get()), goalRevision: 1 })).toBe(false);
  });

  it('guard and permission may check one native invocation, but neither grants replay', async () => {
    const f = await setup();
    const ledger = f.ledger();
    const args = { command: 'make a change' };
    expect(await ledger.beforeNative('Bash', args, 'call_1', 'guard')).toBeUndefined();
    expect(await ledger.beforeNative('Bash', args, 'call_1', 'permission')).toBeUndefined();
    expect(await ledger.beforeNative('Bash', args, 'call_1', 'guard')).toMatch(/may already/);
    expect(await ledger.beforeNative('Bash', args, 'call_2', 'permission')).toMatch(/may already/);
  });

  it('known native reads may repeat, but never become fake provider receipts', async () => {
    const f = await setup();
    expect(await f.ledger().beforeNative('Read', { file_path: 'note.txt' })).toBeUndefined();
    f.restart();
    expect(await f.ledger().beforeNative('Read', { file_path: 'note.txt' })).toBeUndefined();
    expect((await f.get()).operations?.[0]?.state).toBe('unresolved');
  });

  it('empty provider reads may waive conditional work, but never nonempty or earlier-revision sources', async () => {
    const f = await setup();
    f.tool.verification = {
      ...required(f.tool.verification),
      effect: 'read',
      reconcile: async () => ({
        state: 'confirmed',
        receipt: { provider: 'mail', id: 'empty', label: 'No messages', empty: true },
      }),
    };
    await f.ledger().wrap(f.tool).run({});
    const task = {
      ...(await f.get()),
      expectations: [{ tool: 'mail_read', minimum: 1, unlessEmpty: 'draft' }],
    };
    expect(verifiedOutcome(task)).toBe(true);
    expect(verifiedOutcome({ ...task, goalRevision: 1 })).toBe(false);
    const source = required(task.operations?.[0]);
    expect(
      verifiedOutcome({
        ...task,
        operations: [
          ...(task.operations ?? []),
          {
            ...source,
            id: 'nonempty',
            receipt: { provider: 'mail', id: 'messages', label: 'Found messages', empty: false },
          },
        ],
      }),
    ).toBe(false);
  });

  it('fails closed on corrupted receipts, without silently resetting the ledger', async () => {
    const f = await setup();
    await writeFile(join(f.home, 'tasks.json'), '{broken');
    f.restart();
    await expect(f.get()).rejects.toThrow();
    expect(await readFile(join(f.home, 'tasks.json'), 'utf8')).toBe('{broken');
  });

  it('older done records migrate to explicitly unverified', async () => {
    const f = await setup();
    const legacy = { ...(await f.get()), status: 'done' };
    await writeFile(join(f.home, 'tasks.json'), JSON.stringify({ tasks: [legacy] }));
    f.restart();
    expect((await f.get()).status).toBe('unverified');
  });
});

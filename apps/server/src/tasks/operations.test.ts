import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assessTask, type ConversationEvent, type Task } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { HostTool } from '../engines/types';
import { heldInLog, taskArgumentHash, TaskOperations, verifiedOutcome } from './operations';
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

describe('provider result events without approval callbacks', () => {
  it('records native reads and matches their result without duplicating guard events', async () => {
    const f = await setup(),
      ledger = f.ledger();
    await ledger.observeNative('Read', { file_path: 'x' }, 'read1');
    expect(await ledger.beforeNative('Read', { file_path: 'x' }, 'read1')).toBeUndefined();
    await ledger.observeNative('Read', { file_path: 'x' }, 'read1');
    await ledger.afterNative('read1', 'success', 'observed content');
    expect((await f.get()).operations).toHaveLength(1);
    expect((await f.get()).operations?.[0]).toMatchObject({
      state: 'confirmed',
      execution: 'succeeded',
      receipt: { provider: 'native-read' },
    });
  });
  it('observing a native invocation never bypasses the replay guard', async () => {
    const f = await setup();
    const first = f.ledger();
    await first.observeNative('Bash', { command: 'write' }, 'first');
    expect(await first.beforeNative('Bash', { command: 'write' }, 'first')).toBeUndefined();
    const resumed = f.ledger();
    await resumed.observeNative('Bash', { command: 'write' }, 'resumed');
    expect(await resumed.beforeNative('Bash', { command: 'write' }, 'resumed')).toMatch(
      /may already/,
    );
    expect((await f.get()).operations?.every((op) => op.state === 'unresolved')).toBe(true);
  });
  it('keeps opaque provider tools as observations, not independently verified reads', async () => {
    const f = await setup(),
      ledger = f.ledger();
    await ledger.observeNative('mcp__clock__curr_time', { readOnlyHint: true }, 'clock');
    await ledger.afterNative('clock', 'error', 'failed');
    expect((await f.get()).operations?.[0]).toMatchObject({
      effect: 'unknown',
      state: 'unresolved',
      execution: 'failed',
    });
    expect(verifiedOutcome(await f.get())).toBe(false);
    f.stop();
    await ledger.afterNative('clock', 'success', 'late');
    expect((await f.get()).operations?.[0]?.execution).toBe('failed');
  });
  it('preserves an actual delivered answer across restart and invalidates it on backup restore', async () => {
    const f = await setup();
    await f.update({
      status: 'done',
      completion: 'response',
      expectations: undefined,
      verification: 'unverified',
      summary: 'An answer',
      delivery: { goalRevision: 0, attempt: 0, at: 2 },
    });
    f.restart();
    expect(await f.get()).toMatchObject({ status: 'done', verification: 'unverified' });
    const restored = mergeTaskLedgers(
      undefined,
      Buffer.from(JSON.stringify({ tasks: [await f.get()] })),
    );
    expect(
      (JSON.parse(restored.toString()) as { tasks: Task[] }).tasks[0]?.delivery,
    ).toBeUndefined();
  });
});

describe('calls Conch refused before they ran', () => {
  it('a held command is recorded as not run and blocks neither another write nor itself', async () => {
    const f = await setup();
    const ledger = f.ledger();
    // Claude Code reports the call, Conch's hold refuses it, the result is the refusal.
    await ledger.observeNative('Bash', { command: 'touch made.txt' }, 'held');
    await ledger.afterNative('held', 'error', 'Conch held this command', true);
    expect((await f.get()).operations?.[0]).toMatchObject({
      state: 'not-run',
      refused: true,
      error: expect.not.stringContaining('touch'),
    });
    expect(assessTask(await f.get()).reasons.map((r) => r.code)).not.toContain('effect-uncertain');
    expect(
      await ledger.beforeNative('Write', { file_path: 'made.txt', content: 'hi' }, 'w'),
    ).toBeUndefined();
    await ledger.afterNative('w', 'success', 'written');
    expect(
      await ledger.beforeNative('Bash', { command: 'touch made.txt' }, 'again'),
    ).toBeUndefined();
  });

  it('works whichever comes first, the guard or the provider’s report', async () => {
    const f = await setup();
    const ledger = f.ledger();
    // A later guard rule refused it after the ledger had already let it by.
    expect(await ledger.beforeNative('Bash', { command: 'make' }, 'c1', 'guard')).toBeUndefined();
    await ledger.observeNative('Bash', { command: 'make' }, 'c1');
    await ledger.afterNative('c1', 'error', 'refused', true);
    expect((await f.get()).operations).toHaveLength(1);
    expect((await f.get()).operations?.[0]?.state).toBe('not-run');
  });

  it('a refused call that reports success ran after all, and stays guarded', async () => {
    const f = await setup();
    const ledger = f.ledger();
    await ledger.observeNative('Bash', { command: 'deploy' }, 'c1');
    await ledger.afterNative('c1', 'success', 'deployed', true);
    expect((await f.get()).operations?.[0]).toMatchObject({
      state: 'unresolved',
      execution: 'succeeded',
    });
    expect((await f.get()).operations?.[0]?.refused).toBeUndefined();
    expect(await ledger.beforeNative('Bash', { command: 'deploy' }, 'c2')).toMatch(/may already/);
  });

  it('a refusal never clears an action that already has a result, or a reused id', async () => {
    const f = await setup();
    const ledger = f.ledger();
    // It ran and failed: its result is unknown, whatever is said about the id later.
    await ledger.observeNative('Bash', { command: 'migrate' }, 'c1');
    await ledger.afterNative('c1', 'error', 'exit 1');
    await ledger.afterNative('c1', 'error', 'refused', true);
    expect((await f.get()).operations?.[0]).toMatchObject({
      state: 'unresolved',
      execution: 'failed',
    });
    // Two calls under one id: the refusal can't say which one didn't run.
    const g = await setup();
    const other = g.ledger();
    await other.observeNative('Bash', { command: 'one' }, 'dup');
    await other.observeNative('Bash', { command: 'two' }, 'dup');
    await other.afterNative('dup', 'error', 'refused', true);
    expect((await g.get()).operations?.every((op) => op.state === 'unresolved')).toBe(true);
    expect(await other.beforeNative('Write', { file_path: 'x' }, 'w')).toMatch(/may already/);
  });

  it('an uncertain earlier action still blocks later writes after a refusal', async () => {
    const f = await setup();
    const ledger = f.ledger();
    await ledger.observeNative('Bash', { command: 'migrate' }, 'ran');
    await ledger.afterNative('ran', 'error', 'exit 1');
    await ledger.observeNative('Bash', { command: 'touch x' }, 'held');
    await ledger.afterNative('held', 'error', 'refused', true);
    expect(await ledger.beforeNative('Write', { file_path: 'x' }, 'w')).toMatch(/may already/);
  });

  it('Conch’s own tool refused before dispatch is kept as not run, under a key of its own', async () => {
    const f = await setup();
    const ledger = f.ledger();
    await ledger.observeNative('Bash', { command: 'migrate' }, 'ran');
    await ledger.afterNative('ran', 'error', 'exit 1');
    const start: HostTool = {
      name: 'process_start',
      description: 'Start',
      input: {},
      run: vi.fn(async () => 'Started.'),
    };
    await expect(ledger.wrap(start).run({ command: 'npm test' })).rejects.toThrow(/may already/);
    expect(start.run).not.toHaveBeenCalled();
    const kept = (await f.get()).operations?.find((op) => op.tool === 'process_start');
    expect(kept).toMatchObject({ state: 'not-run', refused: true, effect: 'unknown' });
    expect(JSON.stringify(kept)).not.toContain('npm test');
    // The uncertain one is untouched; the record of the refusal blocks nothing by itself.
    expect((await f.get()).operations?.[0]).toMatchObject({ state: 'unresolved' });
    expect(assessTask(await f.get()).reasons.filter((r) => r.code === 'effect-uncertain')).toEqual([
      expect.objectContaining({ tool: 'Bash' }),
    ]);
  });

  it('a refused replay of an uncertain write never turns it into one that did not run', async () => {
    const f = await setup();
    f.unreadable();
    await f.ledger().wrap(f.tool).run({});
    expect((await f.get()).operations?.[0]?.state).toBe('unresolved');
    f.restart();
    await expect(f.ledger().wrap(f.tool).run({})).rejects.toThrow(/may already/);
    const ops = (await f.get()).operations ?? [];
    expect(ops[0]).toMatchObject({ state: 'unresolved', tool: 'draft' });
    expect(ops[0]?.refused).toBeUndefined();
    expect(verifiedOutcome(await f.get())).toBe(false);
  });

  it('a refusal recorded for a tool never uses up its approved number of actions', async () => {
    const f = await setup();
    await f.update({ toolScope: { names: ['draft'], limits: { draft: 1 } } });
    await f.ledger().observeNative('Bash', { command: 'migrate' }, 'ran');
    await f.ledger().afterNative('ran', 'error', 'exit 1');
    await expect(f.ledger().wrap(f.tool).run({ body: 'one' })).rejects.toThrow(/may already/);
    // Someone looked: the uncertain command never happened.
    await f.update({
      operations: (await f.get()).operations?.map((op) =>
        op.tool === 'Bash' ? { ...op, state: 'not-run' as const } : op,
      ),
    });
    expect(await f.ledger().wrap(f.tool).run({ body: 'one' })).toBe('Saved; nothing sent.');
  });
});

describe('looking things up is not an action', () => {
  it('loading a tool’s schema and a read-only command are reads, with their own receipts', async () => {
    const f = await setup();
    await f.update({ completion: 'response', expectations: undefined });
    const ledger = f.ledger();
    await ledger.observeNative('ToolSearch', { query: 'select:Write' }, 'ts');
    await ledger.afterNative('ts', 'success', 'schema');
    await ledger.observeNative('Bash', { command: 'ls -la' }, 'ls');
    await ledger.afterNative('ls', 'success', 'listing');
    expect((await f.get()).operations?.map((op) => [op.effect, op.state])).toEqual([
      ['read', 'confirmed'],
      ['read', 'confirmed'],
    ]);
    const answered = {
      ...(await f.get()),
      summary: 'The answer.',
      delivery: { goalRevision: 0, attempt: 0, at: 1 },
    };
    expect(assessTask(answered).verdict).toBe('delivered');
    // With checks, a schema lookup no longer outranks them.
    const checked = {
      ...(await f.get()),
      completion: 'evidence' as const,
      expectations: [{ tool: 'Bash', minimum: 1 }],
    };
    expect(assessTask(checked).verdict).toBe('verified');
  });

  it('a command that writes stays an action, even beside reads', async () => {
    const f = await setup();
    const ledger = f.ledger();
    await ledger.observeNative('Bash', { command: 'ls > listing.txt' }, 'c');
    expect((await f.get()).operations?.[0]?.effect).toBe('unknown');
    expect(await ledger.beforeNative('Bash', { command: 'ls > listing.txt' }, 'd')).toMatch(
      /may already/,
    );
  });
});

describe('a task an older version locked with a refused call', () => {
  const started = (toolUseId: string): ConversationEvent => ({
    conversationId: 'c',
    seq: 1,
    at: 1,
    type: 'tool.started',
    toolUseId,
    name: 'Bash',
    input: {},
  });
  const finished = (
    toolUseId: string,
    status: 'success' | 'error',
    approval?: 'refused' | 'declined' | 'allowed',
  ): ConversationEvent => ({
    conversationId: 'c',
    seq: 2,
    at: 2,
    type: 'tool.finished',
    toolUseId,
    status,
    ...(approval && { approval }),
  });

  it('is settled from Conch’s own log of refusing it, and only from that', async () => {
    const f = await setup();
    const ledger = f.ledger();
    for (const id of ['held', 'declined', 'ran', 'allowed'] as const) {
      await ledger.observeNative('Bash', { command: id }, id);
      await ledger.afterNative(id, 'error', 'whatever');
    }
    const operations = (await f.get()).operations ?? [];
    const settled = heldInLog(operations, [
      started('held'),
      finished('held', 'error', 'refused'),
      started('declined'),
      finished('declined', 'error', 'declined'),
      // It ran and failed: no refusal in the log.
      started('ran'),
      finished('ran', 'error'),
      // The person allowed it: it ran.
      started('allowed'),
      finished('allowed', 'error', 'allowed'),
    ]);
    expect(settled?.map((op) => op.state)).toEqual([
      'not-run',
      'not-run',
      'unresolved',
      'unresolved',
    ]);
    expect(heldInLog(settled ?? [], [])).toBeUndefined();
  });

  it('never on a log that shows the id twice, or a result that says it ran', async () => {
    const f = await setup();
    const ledger = f.ledger();
    await ledger.observeNative('Bash', { command: 'x' }, 'twice');
    await ledger.afterNative('twice', 'error', 'whatever');
    const operations = (await f.get()).operations ?? [];
    expect(
      heldInLog(operations, [
        started('twice'),
        finished('twice', 'error', 'refused'),
        started('twice'),
        finished('twice', 'error'),
      ]),
    ).toBeUndefined();
    expect(
      heldInLog(operations, [started('twice'), finished('twice', 'success', 'refused')]),
    ).toBeUndefined();
  });
});

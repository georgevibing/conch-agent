import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessTask, type Task } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTools } from '../engines/api/engine';
import { hostComputerTools } from '../engines/host';
import type { HostTool, TurnInput } from '../engines/types';
import { tasksCheck } from './doctor';
import { TaskOperations, taskArgumentHash, verifiedOutcome } from './operations';

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture(expectations?: Task['expectations']) {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-verification-'));
  homes.push(cwd);
  let task: Task = {
    id: 'probe',
    title: 'Probe',
    prompt: 'Probe',
    kind: 'background',
    status: 'running',
    createdAt: 1,
    rev: 0,
    options: {},
    steps: [],
    operations: [],
    expectations,
  };
  let stopped = false;
  const makeLedger = () =>
    new TaskOperations(
      async () => task,
      async (change) => (task = { ...task, ...change(task) }),
      () => stopped,
    );
  let ledger = makeLedger();
  const input: TurnInput = {
    conversationId: 'probe',
    cwd,
    tools: [],
    prompt: '',
    systemAppend: '',
    signal: new AbortController().signal,
    options: { permissionMode: 'bypassPermissions', effort: 'auto', fastMode: false },
    requestPermission: async () => 'allow',
  };
  let tools = new Map(hostComputerTools(input).map((tool) => [tool.name, ledger.wrap(tool)]));
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error('Missing tool');
    return tool.run(args);
  };
  return {
    cwd,
    input,
    ledger,
    call,
    resume: () => {
      ledger = makeLedger();
      tools = new Map(hostComputerTools(input).map((tool) => [tool.name, ledger.wrap(tool)]));
    },
    get: () => task,
    stop: () => {
      stopped = true;
    },
  };
}

describe('task evidence across real tool sequences', () => {
  it('finishes general work without pretending that observed effects certify the whole goal', async () => {
    const f = await fixture();
    await f.call('Write', { file_path: 'a.txt', content: 'a' });
    expect(f.get().operations?.[0]?.state).toBe('confirmed');
    expect(assessTask(f.get())).toMatchObject({
      verdict: 'unchecked',
      reasons: [{ code: 'no-criteria' }],
    });
    expect(verifiedOutcome({ ...f.get(), expectations: [{ tool: 'Write', minimum: 1 }] })).toBe(
      true,
    );
    const done = { ...f.get(), status: 'unverified' as const, modelCompleted: true };
    expect(
      await tasksCheck({ list: async () => ({ tasks: [done], concurrent: 3 }) } as never).run({
        repair: false,
        signal: new AbortController().signal,
      }),
    ).toEqual([expect.objectContaining({ state: 'ok' })]);
  });

  it('supports Write, Edit, Read, another Write, and a return to the first contents', async () => {
    const f = await fixture([
      { tool: 'Write', minimum: 1 },
      { tool: 'Edit', minimum: 1 },
      { tool: 'Read', minimum: 1 },
    ]);
    await f.call('Write', { file_path: 'a.txt', content: 'initial' });
    await f.call('Edit', { file_path: 'a.txt', old_string: 'initial', new_string: 'edited' });
    await f.call('Write', { file_path: 'a.txt', content: 'final' });
    await f.call('Write', { file_path: 'a.txt', content: 'initial' });
    expect(await f.call('Read', { file_path: 'a.txt' })).toBe('initial');
    expect(verifiedOutcome(f.get())).toBe(true);
    expect(f.get().operations?.every((op) => op.state === 'confirmed')).toBe(true);
  });

  it('a resumed turn cannot replay earlier writes over its saved final contents', async () => {
    const f = await fixture();
    await f.call('Write', { file_path: 'a.txt', content: 'initial' });
    await f.call('Edit', { file_path: 'a.txt', old_string: 'initial', new_string: 'edited' });
    await f.call('Write', { file_path: 'a.txt', content: 'final' });
    f.resume();
    expect(await f.call('Write', { file_path: 'a.txt', content: 'initial' })).toMatch(
      /Already confirmed/,
    );
    expect(
      await f.call('Edit', { file_path: 'a.txt', old_string: 'initial', new_string: 'edited' }),
    ).toMatch(/Already confirmed/);
    expect(await f.call('Read', { file_path: 'a.txt' })).toBe('final');
    expect(f.get().operations?.filter((op) => op.effect === 'write')).toHaveLength(3);
    // A genuinely new mutation in this resumed turn can still extend the work.
    await f.call('Write', { file_path: 'a.txt', content: 'next' });
    expect(await f.call('Read', { file_path: 'a.txt' })).toBe('next');
  });

  it('retains the first nonempty observation when the same search later becomes empty', async () => {
    const f = await fixture([{ tool: 'read_message', minimum: 1, unlessEmpty: 'search' }]);
    let empty = false;
    const tool = f.ledger.wrap({
      name: 'search',
      description: '',
      input: {},
      run: async () => 'results',
      verification: {
        effect: 'read',
        scope: async () => ({
          account: 'test',
          authorization: 'read',
          expiresAt: Number.MAX_SAFE_INTEGER,
        }),
        reconcile: async () => ({
          state: 'confirmed',
          receipt: { provider: 'test', id: String(empty), label: 'Search', empty },
        }),
      },
    });
    await tool.run({ query: 'same' });
    empty = true;
    await tool.run({ query: 'same' });
    expect(f.get().operations?.map((op) => op.receipt?.empty)).toEqual([false, true]);
    expect(new Set(f.get().operations?.map((op) => op.id)).size).toBe(2);
    expect(verifiedOutcome(f.get())).toBe(false);
  });

  it('a failed reread cannot reuse old bytes or satisfy a current required read', async () => {
    const f = await fixture([{ tool: 'Read', minimum: 1 }]);
    await writeFile(join(f.cwd, 'a.txt'), 'old');
    await f.call('Read', { file_path: 'a.txt' });
    await writeFile(join(f.cwd, 'a.txt'), 'x'.repeat(1024 * 1024 + 1));
    await expect(f.call('Read', { file_path: 'a.txt' })).rejects.toThrow('smaller');
    expect(f.get().operations?.at(-1)).toMatchObject({ execution: 'failed', state: 'unresolved' });
    expect(f.get().operations?.at(-1)?.receipt).toBeUndefined();
    expect(verifiedOutcome(f.get())).toBe(false);
    await writeFile(join(f.cwd, 'a.txt'), 'new');
    expect(await f.call('Read', { file_path: 'a.txt' })).toBe('new');
    expect(verifiedOutcome(f.get())).toBe(true);
  });

  it.each(['Read', 'LS'])(
    'a missing %s target invalidates old evidence and can recover',
    async (name) => {
      const f = await fixture([{ tool: name, minimum: 1 }]);
      const target = join(f.cwd, 'target');
      const args = name === 'Read' ? { file_path: 'target' } : { path: 'target' };
      const create = () => (name === 'Read' ? writeFile(target, 'value') : mkdir(target));
      await create();
      await f.call(name, args);
      expect(verifiedOutcome(f.get())).toBe(true);
      await rm(target, { recursive: true });
      await expect(f.call(name, args)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(f.get().operations).toHaveLength(2);
      expect(assessTask(f.get())).toMatchObject({ verdict: 'incomplete', failedReads: 1 });
      expect(f.get().operations?.at(-1)).toMatchObject({ state: 'not-run', execution: 'failed' });
      expect(f.get().operations?.at(-1)?.receipt).toBeUndefined();
      await create();
      await f.call(name, args);
      expect(verifiedOutcome(f.get())).toBe(true);
      expect(f.get().operations).toHaveLength(3);
    },
  );

  it('a rejected optional read does not block writing a recovery file', async () => {
    const f = await fixture([{ tool: 'Write', minimum: 1 }]);
    await expect(f.call('Read', { file_path: 'missing' })).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await f.call('Write', { file_path: 'recovered', content: 'ok' });
    expect(assessTask(f.get())).toMatchObject({ verdict: 'verified', failedReads: 1 });
    expect(f.get().operations).toHaveLength(2);
  });

  it.each(['throw', 'expire'])(
    'a read scope that can %s cannot leave a stale success',
    async (failure) => {
      const f = await fixture([{ tool: 'lookup', minimum: 1 }]);
      let valid = true;
      const run = vi.fn(async () => 'observed');
      const lookup = f.ledger.wrap({
        name: 'lookup',
        description: '',
        input: {},
        run,
        verification: {
          effect: 'read',
          scope: async () => {
            if (!valid && failure === 'throw') throw new Error('private provider details');
            return {
              account: 'fixture',
              authorization: 'fixture',
              expiresAt: valid || failure === 'throw' ? Number.MAX_SAFE_INTEGER : 0,
            };
          },
          reconcile: async () => ({
            state: 'confirmed',
            receipt: { provider: 'fixture', id: 'observation', label: 'Read result' },
          }),
        },
      });
      await lookup.run({});
      valid = false;
      await expect(lookup.run({})).rejects.toThrow();
      expect(run).toHaveBeenCalledTimes(1);
      expect(assessTask(f.get())).toMatchObject({ verdict: 'incomplete', failedReads: 1 });
      expect(JSON.stringify(f.get().operations)).not.toContain('private provider details');
      valid = true;
      await lookup.run({});
      expect(verifiedOutcome(f.get())).toBe(true);
    },
  );

  it('an optional failed read does not poison completed work, but required evidence is still required', async () => {
    const f = await fixture([{ tool: 'Write', minimum: 1 }]);
    const read = f.ledger.wrap({
      name: 'lookup',
      effect: 'read',
      description: '',
      input: {},
      run: async () => {
        throw new Error('lookup failed');
      },
    });
    await expect(read.run({})).rejects.toThrow('lookup failed');
    await f.call('Write', { file_path: 'a.txt', content: 'ok' });
    expect(verifiedOutcome(f.get())).toBe(true);
    expect(verifiedOutcome({ ...f.get(), expectations: [{ tool: 'lookup', minimum: 1 }] })).toBe(
      false,
    );
  });

  it('known research reads produce observations and allow a subsequent write', async () => {
    const f = await fixture([
      { tool: 'web_fetch', minimum: 1 },
      { tool: 'Write', minimum: 1 },
    ]);
    await f.ledger
      .wrap({
        name: 'web_fetch',
        effect: 'read',
        description: '',
        input: {},
        run: async () => 'page',
      })
      .run({});
    await f.call('Write', { file_path: 'a.txt', content: 'summary' });
    expect(verifiedOutcome(f.get())).toBe(true);
  });

  it('preserves structured errors through the ledger and shared adapter', async () => {
    const f = await fixture([{ tool: 'lookup', minimum: 1 }]);
    const tool: HostTool = {
      name: 'lookup',
      effect: 'read',
      description: '',
      input: {},
      run: async () => ({ text: 'Failed to read', isError: true }),
    };
    const tools = buildTools({ ...f.input, tools: [f.ledger.wrap(tool)] }, { computer: false });
    expect(await tools.get('mcp__conch__lookup')?.run({}, 'read1')).toMatchObject({
      isError: true,
      text: 'Failed to read',
    });
    expect(f.get().operations?.at(-1)?.receipt).toBeUndefined();
    expect(verifiedOutcome(f.get())).toBe(false);
  });

  it('records native read results by invocation and ignores late results after Stop', async () => {
    const f = await fixture([{ tool: 'Read', minimum: 1 }]);
    await f.ledger.beforeNative('Read', { file_path: 'a.txt' }, 'r1');
    await f.ledger.afterNative('r1', 'success', 'first');
    expect(verifiedOutcome(f.get())).toBe(true);
    await f.ledger.beforeNative('Read', { file_path: 'a.txt' }, 'r2');
    await f.ledger.afterNative('r2', 'error', 'failed');
    expect(verifiedOutcome(f.get())).toBe(false);
    // Some providers reuse call IDs in a later turn. Settle the latest attempt.
    await f.ledger.beforeNative('Read', { file_path: 'a.txt' }, 'r1');
    await f.ledger.afterNative('r1', 'error', 'failed again');
    expect(f.get().operations?.at(-1)?.execution).toBe('failed');
    f.stop();
    await f.ledger.afterNative('r2', 'success', 'late');
    expect(verifiedOutcome(f.get())).toBe(false);
  });

  it('a native read finishing out of order cannot replace the newer failed observation', async () => {
    const f = await fixture([{ tool: 'Read', minimum: 1 }]);
    await f.ledger.beforeNative('Read', { file_path: 'a.txt' }, 'early');
    await f.ledger.beforeNative('Read', { file_path: 'a.txt' }, 'late');
    await f.ledger.afterNative('late', 'error', 'new read failed');
    await f.ledger.afterNative('early', 'success', 'old contents');
    expect(f.get().operations?.map((op) => op.invocationId)).toEqual(['early', 'late']);
    expect(verifiedOutcome(f.get())).toBe(false);
  });

  it('cannot correlate native checks without an invocation ID to bypass replay protection', async () => {
    const f = await fixture();
    expect(
      await f.ledger.beforeNative('Bash', { command: 'write' }, undefined, 'guard'),
    ).toBeUndefined();
    expect(
      await f.ledger.beforeNative('Bash', { command: 'write' }, undefined, 'permission'),
    ).toContain('may already');
  });

  it('a completed opaque tool permits different work, but never automatic replay of its action', async () => {
    const f = await fixture();
    const run = vi.fn(async () => 'accepted');
    const opaque = f.ledger.wrap({ name: 'opaque', description: '', input: {}, run });
    await opaque.run({ action: 'a' });
    await f.call('Write', { file_path: 'a.txt', content: 'different work' });
    await expect(opaque.run({ action: 'a' })).rejects.toThrow('may already');
    expect(run).toHaveBeenCalledOnce();
    expect(assessTask(f.get()).reasons).toContainEqual(
      expect.objectContaining({ code: 'receipt-unavailable' }),
    );
  });

  it('binds required evidence to the requested arguments and saved target', async () => {
    const args = { file_path: 'a.txt', content: 'requested' };
    const f = await fixture([{ tool: 'Write', minimum: 1, inputHash: taskArgumentHash(args) }]);
    await f.call('Write', { ...args, content: 'different' });
    expect(verifiedOutcome(f.get())).toBe(false);
    await f.call('Write', args);
    expect(verifiedOutcome(f.get())).toBe(true);
    const receipt = f.get().operations?.at(-1)?.receipt;
    if (!receipt) throw new Error('Missing receipt');
    expect(
      verifiedOutcome({ ...f.get(), expectations: [{ tool: 'Write', minimum: 1, receipt }] }),
    ).toBe(true);
    expect(
      verifiedOutcome({
        ...f.get(),
        expectations: [
          { tool: 'Write', minimum: 1, receipt: { ...receipt, id: 'another target' } },
        ],
      }),
    ).toBe(false);
  });

  it('a changed file prevents dispatch without poisoning the task and can be retried', async () => {
    const f = await fixture([{ tool: 'Write', minimum: 1 }]);
    const original = hostComputerTools(f.input).find((tool) => tool.name === 'Write');
    if (!original) throw new Error('Missing Write');
    let race = true;
    const write = f.ledger.wrap({
      ...original,
      run: async (args, context) => {
        if (race) await writeFile(join(f.cwd, 'a.txt'), 'another edit');
        race = false;
        return original.run(args, context);
      },
    });
    const args = { file_path: 'a.txt', content: 'requested' };
    expect(await write.run(args)).toMatchObject({ isError: true, effect: 'not-executed' });
    expect(f.get().operations?.[0]?.state).toBe('not-run');
    expect(assessTask(f.get()).reasons).not.toContainEqual(
      expect.objectContaining({ code: 'effect-uncertain' }),
    );
    await write.run(args);
    expect(verifiedOutcome(f.get())).toBe(true);
    expect(await f.call('Read', { file_path: 'a.txt' })).toBe('requested');
  });

  it('Stop wins if it arrives during receipt reconciliation or an opaque call', async () => {
    const f = await fixture([{ tool: 'write', minimum: 1 }]);
    await f.ledger
      .wrap({
        name: 'write',
        description: '',
        input: {},
        run: async () => 'saved',
        verification: {
          effect: 'write',
          scope: async () => ({
            account: 'test',
            authorization: 'write',
            expiresAt: Number.MAX_SAFE_INTEGER,
          }),
          reconcile: async () => {
            f.stop();
            return {
              state: 'confirmed',
              receipt: { provider: 'test', id: 'late', label: 'Late receipt' },
            };
          },
        },
      })
      .run({});
    expect(f.get().operations?.[0]?.receipt).toBeUndefined();
    expect(assessTask(f.get()).verdict).toBe('uncertain');
    const opaque = await fixture();
    await expect(
      opaque.ledger
        .wrap({
          name: 'opaque',
          description: '',
          input: {},
          run: async () => {
            opaque.stop();
            return 'saved';
          },
        })
        .run({}),
    ).rejects.toThrow('stopped');
    expect(assessTask(opaque.get()).verdict).toBe('uncertain');
  });

  it('a lost response still blocks new effects across tools', async () => {
    const f = await fixture();
    await expect(
      f.ledger
        .wrap({
          name: 'opaque',
          description: '',
          input: {},
          run: async () => {
            throw new Error('lost response');
          },
        })
        .run({}),
    ).rejects.toThrow('lost response');
    await expect(f.call('Write', { file_path: 'a.txt', content: 'blocked' })).rejects.toThrow(
      'may already',
    );
    expect(assessTask(f.get()).verdict).toBe('uncertain');
  });
});

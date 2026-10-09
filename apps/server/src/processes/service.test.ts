import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { ProcessService } from './service';
import { resourcePolicy, type ResourceSnapshot } from '../recovery/resources';

const healthy = () =>
  resourcePolicy({
    at: Date.now(),
    totalBytes: 16 * 1024 ** 3,
    availableBytes: 8 * 1024 ** 3,
    cpuCount: 8,
    loadPerCpu: 0,
    memoryPressure: 0,
  });

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0)) await clean();
  vi.unstubAllEnvs();
});
async function setup(
  options: {
    now?: () => number;
    protectedPaths?: string[];
    resources?: () => Promise<ResourceSnapshot>;
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-process-'));
  const service = new ProcessService({
    protectedPaths: [],
    sealed: async () => false,
    resources: async () => healthy(),
    ...options,
  });
  cleanups.push(async () => {
    service.close();
    await new Promise((r) => setTimeout(r, 50));
    await rm(cwd, { recursive: true, force: true });
  });
  const ctx: ToolContext = {
    conversationId: 'one',
    append: () => {},
    engine: {} as never,
    permissionMode: 'bypassPermissions',
    ask: async () => 'allow',
    signal: new AbortController().signal,
    workspace: async () => cwd,
  };
  const run = async (name: string, args: Record<string, unknown>, context = ctx) => {
    const tool = service.tools(context).find((t) => t.name === name);
    if (!tool) throw new Error('Missing tool');
    return tool.run(args);
  };
  const read = async (id: string, context = ctx) =>
    JSON.parse(String(await run('process_read', { id }, context))) as {
      status: string;
      output: string;
      nextOffset: number;
      discardedBefore: number;
      exitCode: number | null;
    };
  const start = async (command: string, context = ctx, timeout_ms = 5000) =>
    JSON.parse(String(await run('process_start', { command, timeout_ms }, context))) as {
      id: string;
    };
  return { service, ctx, run, read, start };
}
async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('Process did not settle');
}

describe('managed commands', () => {
  it('marks the chat by what a command reads, not by every output (ADR 0028, ADR 0117)', async () => {
    const { start, read, ctx } = await setup();
    const taint = vi.fn();
    const own = { ...ctx, taint };
    // A build's or a test's own output is the person's own work.
    const local = await start('echo all tests passed', own);
    await until(
      () => read(local.id, own),
      (v) => v.status === 'exited',
    );
    expect(taint).not.toHaveBeenCalled();
    // A command that names an address on the internet reads someone else's words.
    const remote = await start('echo https://news.example/today', own);
    await until(
      () => read(remote.id, own),
      (v) => v.status === 'exited',
    );
    expect(taint).toHaveBeenCalledWith({ kind: 'download', label: 'news.example' });
  });

  it('queues under pressure and starts approved work when resources recover', async () => {
    let now = 1000;
    let snapshot = { ...healthy(), concurrency: 0, level: 'busy' as const } as ResourceSnapshot;
    const { service, start, read, ctx } = await setup({
      resources: async () => snapshot,
      now: () => now,
    });
    const ask = vi.fn(async () => 'allow' as const);
    const { id } = await start(
      'echo recovered',
      { ...ctx, permissionMode: 'default', ask },
      60_000,
    );
    expect((await read(id)).status).toBe('queued');
    expect(ask).toHaveBeenCalledOnce();
    snapshot = healthy();
    await service.resumeAdmission();
    expect((await read(id)).status).toBe('queued');
    for (let i = 0; i < 3; i++) {
      now += 10_000;
      await service.resumeAdmission();
    }
    expect(
      (
        await until(
          () => read(id),
          (v) => v.status === 'exited',
        )
      ).output,
    ).toContain('recovered');
    expect(ask).toHaveBeenCalledOnce();
  });
  it('never executes cancelled or expired queued commands', async () => {
    const { service, start, read, ctx } = await setup();
    service.pauseAdmission();
    const abort = new AbortController();
    const cancelled = await start('echo must-not-run', { ...ctx, signal: abort.signal });
    abort.abort();
    const expired = await start('echo must-not-run', ctx, 30);
    await until(
      () => read(expired.id),
      (v) => v.status === 'timed-out',
    );
    await service.resumeAdmission();
    expect(await read(cancelled.id)).toMatchObject({ status: 'stopped', output: '' });
    expect(await read(expired.id)).toMatchObject({ status: 'timed-out', output: '' });
  });
  it('bounds queue size and stops queued work on shutdown', async () => {
    const { service, start, read } = await setup();
    service.pauseAdmission('Conch is recovering.');
    const jobs = [];
    for (let i = 0; i < 8; i++) jobs.push(await start('echo queued'));
    await expect(start('echo overflow')).rejects.toThrow('enough commands waiting');
    service.close();
    for (const job of jobs)
      expect(await read(job.id)).toMatchObject({ status: 'stopped', output: '' });
    await service.resumeAdmission();
    for (const job of jobs) expect((await read(job.id)).status).toBe('stopped');
  });
  it('gives another chat the next slot and keeps cancellation scoped to its owner', async () => {
    const { service, start, read, run, ctx } = await setup({
      resources: async () => ({ ...healthy(), concurrency: 1 }),
    });
    const first = await start('node -e "setInterval(()=>{},1000)"');
    const ownQueued = await start('echo own');
    const other = { ...ctx, conversationId: 'two' };
    const otherQueued = await start('node -e "setInterval(()=>{},1000)"', other);
    expect((await read(ownQueued.id)).status).toBe('queued');
    await run('process_stop', { id: first.id });
    await until(
      () => read(otherQueued.id, other),
      (v) => v.status === 'running',
    );
    expect((await read(ownQueued.id)).status).toBe('queued');
    service.stopAll('one');
    expect((await read(otherQueued.id, other)).status).toBe('running');
  });
  it('sheds one managed tree only after sustained critical memory pressure', async () => {
    let now = 1000;
    let snapshot = healthy();
    const { service, start, read } = await setup({
      now: () => now,
      resources: async () => snapshot,
    });
    const older = await start('node -e "setInterval(()=>{},1000)"');
    const newer = await start('node -e "setInterval(()=>{},1000)"');
    snapshot = { ...snapshot, level: 'critical', concurrency: 0 };
    await service.resumeAdmission();
    now += 14_000;
    await service.resumeAdmission();
    expect((await read(newer.id)).status).toBe('running');
    now += 1001;
    await service.resumeAdmission();
    expect((await read(newer.id)).status).toBe('stopped');
    expect((await read(older.id)).status).toBe('running');
    await service.resumeAdmission();
    expect((await read(older.id)).status).toBe('running');
  });
  it('fails closed if resource sampling fails and does not write to queued processes', async () => {
    const { start, read, run } = await setup({
      resources: async () => {
        throw new Error('sample unavailable');
      },
    });
    const { id } = await start('echo not-yet');
    expect((await read(id)).status).toBe('queued');
    await expect(run('process_write', { id, text: 'input' })).rejects.toThrow('waiting to start');
  });

  it('shares concurrent resource samples and keeps completed children paused during recovery', async () => {
    const resources = vi.fn(async () => healthy());
    const { service, start, read } = await setup({ resources });
    const samples = await Promise.all([service.resourceSnapshot(), service.resourceSnapshot()]);
    expect(samples[0]).toBe(samples[1]);
    expect(resources).toHaveBeenCalledOnce();
    await start('node -e "setTimeout(()=>{},100)"');
    service.pauseAdmission();
    const queued = await start('echo must-wait');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await read(queued.id)).toMatchObject({ status: 'queued', output: '' });
  });
  it('shares the workload relief cooldown with the external watchdog', async () => {
    const { service, start, read } = await setup();
    const older = await start('node -e "setInterval(()=>{},1000)"');
    const newer = await start('node -e "setInterval(()=>{},1000)"');
    expect(service.relievePressure().stopped).toBe(1);
    expect(service.relievePressure().stopped).toBe(0);
    expect((await read(newer.id)).status).toBe('stopped');
    expect((await read(older.id)).status).toBe('running');
  });

  it('restores one shared slot at a time across chats and does not replay cancelled work', async () => {
    let now = 1000;
    let snapshot: ResourceSnapshot = { ...healthy(), level: 'busy', concurrency: 0 };
    const { service, start, read, run, ctx } = await setup({
      now: () => now,
      resources: async () => snapshot,
    });
    const other = { ...ctx, conversationId: 'two' };
    const command = 'node -e "setInterval(()=>{},1000)"';
    const one = await start(command, ctx, 120_000);
    const two = await start(command, other, 120_000);
    const cancelled = await start('echo must-not-run', other, 120_000);
    await run('process_stop', { id: cancelled.id }, other);
    snapshot = healthy();
    await service.resumeAdmission();
    for (let i = 0; i < 3; i++) {
      now += 10_000;
      await service.resumeAdmission();
    }
    expect((await read(one.id)).status).toBe('running');
    expect((await read(two.id, other)).status).toBe('queued');
    now += 10_000;
    await service.resumeAdmission();
    expect((await read(two.id, other)).status).toBe('running');
    expect(await read(cancelled.id, other)).toMatchObject({ status: 'stopped', output: '' });
  });

  it('shares cached readings across tool bursts and refreshes them after a second', async () => {
    let now = 0;
    const resources = vi.fn(async () => healthy());
    const { service } = await setup({ now: () => now, resources });
    await Promise.all(Array.from({ length: 100 }, () => service.resourceSnapshot()));
    await service.resourceSnapshot();
    expect(resources).toHaveBeenCalledOnce();
    now = 1001;
    await service.resourceSnapshot();
    expect(resources).toHaveBeenCalledTimes(2);
  });

  it('can wait for resource changes without a command, and Stop cancels that wait', async () => {
    const { run, ctx } = await setup();
    const abort = new AbortController();
    const waiting = run('process_read', { wait_ms: 30_000 }, { ...ctx, signal: abort.signal });
    abort.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('recovers its shared sampler after a timeout and ignores the late old result', async () => {
    let late: ((value: ResourceSnapshot) => void) | undefined;
    const { service } = await setup({
      resources: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ResourceSnapshot>((resolve) => {
              late = resolve;
            }),
        )
        .mockResolvedValue(healthy()),
    });
    vi.useFakeTimers();
    try {
      const failure = expect(service.resourceSnapshot()).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(2001);
      await failure;
      expect(service.workload).toMatchObject({ phase: 'held', cause: 'unknown' });
      await vi.advanceTimersByTimeAsync(1001);
      await service.resourceSnapshot();
      expect(service.workload).toMatchObject({ phase: 'recovering', concurrency: 0 });
      late?.({ ...healthy(), level: 'critical', concurrency: 0 });
      await Promise.resolve();
      expect((await service.resourceSnapshot()).level).toBe('healthy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off a failed sampler even when many chats keep checking', async () => {
    let now = 0;
    const resources = vi.fn(async () => {
      throw new Error('not readable');
    });
    const { service } = await setup({ now: () => now, resources });
    await service.resourceSnapshot().catch(() => undefined);
    for (let i = 0; i < 50; i++) await service.resourceSnapshot().catch(() => undefined);
    expect(resources).toHaveBeenCalledOnce();
    now = 1001;
    await service.resourceSnapshot().catch(() => undefined);
    expect(resources).toHaveBeenCalledTimes(2);
  });

  it('captures exit codes and logs, with no ambient credentials', async () => {
    const { start, read } = await setup();
    vi.stubEnv('CONCH_TEST_SECRET', 'private');
    const { id } = await start(
      `node -e "console.log(process.env.CONCH_TEST_SECRET || 'clean');process.exit(7)"`,
    );
    const result = await until(
      () => read(id),
      (v) => v.status === 'exited',
    );
    expect(result.output).toContain('clean');
    expect(result.exitCode).toBe(7);
  });
  it('supports stdin and isolates every handle to its own chat', async () => {
    const { start, run, read, ctx } = await setup();
    const { id } = await start(
      `node -e "process.stdin.once('data',d=>{console.log(d.toString());process.exit()})"`,
    );
    for (const name of ['process_read', 'process_write', 'process_stop'])
      await expect(
        run(name, { id, text: 'bad' }, { ...ctx, conversationId: 'two' }),
      ).rejects.toThrow('this chat');
    await run('process_write', { id, text: 'hello\n' });
    expect(
      (
        await until(
          () => read(id),
          (v) => v.status === 'exited',
        )
      ).output,
    ).toContain('hello');
  });
  it('asks before execution, rejects plan mode, and checks cancellation after approval', async () => {
    const { start, ctx } = await setup();
    const ask = vi.fn(async () => 'deny' as const);
    await expect(start('echo not-run', { ...ctx, permissionMode: 'default', ask })).rejects.toThrow(
      'declined',
    );
    expect(ask).toHaveBeenCalledOnce();
    await expect(start('echo not-run', { ...ctx, permissionMode: 'plan' })).rejects.toThrow(
      'plan mode',
    );
    const abort = new AbortController();
    await expect(
      start('echo not-run', {
        ...ctx,
        permissionMode: 'default',
        signal: abort.signal,
        ask: async () => {
          abort.abort();
          return 'allow';
        },
      }),
    ).rejects.toThrow();
  });
  it('stops commands explicitly and on timeout', async () => {
    const { start, read, run } = await setup();
    const command = `node -e "setInterval(()=>console.log('running'),20)"`;
    const a = await start(command);
    await until(
      () => read(a.id),
      (v) => v.output.includes('running'),
    );
    await run('process_stop', { id: a.id });
    expect((await read(a.id)).status).toBe('stopped');
    await run('process_stop', { id: a.id });
    const b = await start(command, undefined, 100);
    expect(
      (
        await until(
          () => read(b.id),
          (v) => v.status === 'timed-out',
        )
      ).status,
    ).toBe('timed-out');
  });
  it('waits for new output and still asks when full trust runs unattended', async () => {
    const { start, ctx, run } = await setup();
    const ask = vi.fn(async () => 'deny' as const);
    await expect(start('echo refused', { ...ctx, unattended: true, ask })).rejects.toThrow(
      'declined',
    );
    expect(ask).toHaveBeenCalledOnce();
    const { id } = await start(`node -e "setTimeout(()=>console.log('arrived'),100)"`);
    const result = JSON.parse(String(await run('process_read', { id, offset: 0, wait_ms: 2000 })));
    expect(result.output).toContain('arrived');
  });

  it.skipIf(process.platform === 'win32')(
    'kills the command tree when the gateway pipe closes',
    async () => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./worker.mjs', import.meta.url))],
        {
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (b: Buffer) => {
        output += b.toString();
      });
      child.stderr.resume();
      const ended = new Promise((done) => child.once('close', done));
      try {
        child.stdin.write(
          JSON.stringify({
            command: `node -e "console.log('ready');setInterval(()=>{},1000)"`,
            cwd: tmpdir(),
          }) + '\n',
        );
        await until(
          async () => output,
          (s) => s.includes('ready'),
        );
        child.stdin.end();
        await ended;
        expect(child.signalCode).toBe('SIGKILL');
      } finally {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'reaps a detached managed tree when its gateway is forcibly killed',
    async () => {
      const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
      const program =
        "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log('descendant:'+c.pid); setInterval(()=>{},1000)";
      const command = 'node -e ' + JSON.stringify(program);
      const gateway = spawn(
        process.execPath,
        [
          '-e',
          `
      const {spawn}=require('node:child_process');
      const worker=spawn(process.execPath,[process.argv[1]],{detached:true,stdio:['pipe','pipe','pipe']});
      console.log('worker:'+worker.pid);
      worker.stdout.pipe(process.stdout); worker.stderr.pipe(process.stderr);
      worker.stdin.write(JSON.stringify({command:process.argv[2],cwd:process.cwd()})+'\\n');
      setInterval(()=>{},1000);
    `,
          workerPath,
          command,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      gateway.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      gateway.stderr.resume();
      let workerPid: number | undefined;
      let descendantPid: number | undefined;
      const ended = new Promise((resolve) => gateway.once('close', resolve));
      try {
        await until(
          async () => output,
          (value) => value.includes('descendant:'),
        );
        workerPid = Number(/worker:(\d+)/.exec(output)?.[1]);
        descendantPid = Number(/descendant:(\d+)/.exec(output)?.[1]);
        expect(workerPid).toBeGreaterThan(1);
        expect(descendantPid).toBeGreaterThan(1);
        gateway.kill('SIGKILL');
        await ended;
        const dead = async (pid: number) => {
          try {
            process.kill(pid, 0);
            // Minimal containers may not reap orphans promptly; zombies cannot run.
            if (process.platform === 'linux')
              return /\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'));
            return false;
          } catch (error) {
            return ['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '');
          }
        };
        for (const pid of [workerPid, descendantPid]) await until(() => dead(pid), Boolean);
      } finally {
        gateway.kill('SIGKILL');
        if (workerPid) {
          try {
            process.kill(-workerPid, 'SIGKILL');
          } catch {
            /* Already gone. */
          }
        }
        if (descendantPid) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {
            /* Already gone. */
          }
        }
      }
    },
  );

  it('refuses protected paths sent through stdin before asking or writing', async () => {
    const { start, run, ctx } = await setup({ protectedPaths: ['/private/conch-secret'] });
    const { id } = await start('node -e "setInterval(()=>{},1000)"');
    const ask = vi.fn(async () => 'allow' as const);
    await expect(
      run('process_write', { id, text: 'cat /private/conch-secret\n' }, { ...ctx, ask }),
    ).rejects.toThrow();
    expect(ask).not.toHaveBeenCalled();
  });

  it('health looks without stopping work and repairs overdue commands only', async () => {
    let now = 1000;
    const { service, start, read } = await setup({ now: () => now });
    const { id } = await start('node -e "setInterval(()=>{},1000)"');
    const check = service.doctorCheck();
    const signal = new AbortController().signal;
    expect(await check.run({ repair: false, signal })).toMatchObject([{ state: 'ok' }]);
    now += 6000;
    expect(await check.run({ repair: false, signal })).toMatchObject([{ state: 'warning' }]);
    expect((await read(id)).status).toBe('running');
    expect(await check.run({ repair: true, signal })).toMatchObject([{ state: 'fixed' }]);
    expect((await read(id)).status).toBe('timed-out');
  });

  it('bounds retained logs and returns continuation offsets', async () => {
    const { start, read, run } = await setup();
    const { id } = await start(`node -e "process.stdout.write('x'.repeat(100000))"`);
    const result = await until(
      () => read(id),
      (v) => v.status === 'exited',
    );
    expect(result.discardedBefore).toBe(36000);
    expect(result.output.length).toBe(20000);
    const next = JSON.parse(
      String(await run('process_read', { id, offset: result.nextOffset })),
    ) as { offset: number };
    expect(next.offset).toBe(56000);
  });
});

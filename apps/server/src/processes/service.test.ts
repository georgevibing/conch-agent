import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { ProcessService } from './service';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0)) await clean();
  vi.unstubAllEnvs();
});
async function setup(options: { now?: () => number; protectedPaths?: string[] } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-process-'));
  const service = new ProcessService({ protectedPaths: [], sealed: async () => false, ...options });
  cleanups.push(async () => {
    service.stopAll();
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

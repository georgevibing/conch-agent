/** An old, non-IPC launcher can adopt the current watchdog without another install/restart. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface LaunchEvent {
  role: 'legacy' | 'adopter' | 'gateway' | 'frozen' | 'stopping';
  pid: number;
  ppid: number;
  ipc?: boolean;
  adopt?: boolean;
  reason?: string;
  sequence?: number;
}

const PREFIX = 'ADOPTION_TEST ';

async function eventually<T>(read: () => T | undefined, output: () => string): Promise<T> {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    const value = read();
    if (value !== undefined) return value;
    await delay(20);
  }
  throw new Error(`Subprocess did not reach the expected state:\n${output()}`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Process-group cleanup is used only for this isolated fixture, never a running Conch.
describe.skipIf(process.platform === 'win32')('adopting supervision from a legacy launcher', () => {
  it(
    'restarts a frozen IPC gateway once and shuts down the entire adopted chain',
    { timeout: 25_000 },
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'conch-adopt-'));
      const entry = join(home, 'gateway.mts');
      const legacyEntry = join(home, 'legacy.mjs');
      const supervisor = fileURLToPath(new URL('./supervisor.ts', import.meta.url));
      const cwd = resolve(import.meta.dirname, '..');
      // Explicit loader path lets the fixture live in a temporary HOME outside this checkout.
      const loader = import.meta.resolve('tsx');
      await writeFile(
        entry,
        `
      import { existsSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { shouldAdoptSupervisor, shouldSupervise, supervise } from ${JSON.stringify(supervisor)};
      const report = (event) => console.log(${JSON.stringify(PREFIX)} + JSON.stringify({ pid: process.pid, ppid: process.ppid, ...event }));
      const adopt = shouldAdoptSupervisor();
      if (shouldSupervise() || adopt) {
        report({ role: 'adopter', ipc: typeof process.send === 'function', adopt });
        await supervise({ adoptLegacy: adopt, watchdog: {
          startupMs: 5000, unhealthyMs: 300, recoverMs: 150, pollMs: 25, stopMs: 200
        } });
      } else {
        const marker = join(process.env.CONCH_HOME, 'first-gateway');
        const sequence = existsSync(marker) ? 2 : 1;
        writeFileSync(marker, 'started');
        report({ role: 'gateway', ipc: typeof process.send === 'function', adopt,
          reason: process.env.CONCH_STARTED_BECAUSE, sequence });
        const heartbeat = () => process.send?.({ type: 'conch.heartbeat', healthy: true });
        heartbeat();
        setInterval(heartbeat, 25);
        process.on('SIGTERM', () => {
          report({ role: 'stopping' });
          process.send?.({ type: 'conch.stopping' });
          process.exit(0);
        });
        if (sequence === 1) setTimeout(() => {
          report({ role: 'frozen' });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }, 150);
      }
    `,
      );
      await writeFile(
        legacyEntry,
        `
      import { spawn } from 'node:child_process';
      console.log(${JSON.stringify(PREFIX)} + JSON.stringify({ role: 'legacy', pid: process.pid, ppid: process.ppid }));
      const child = spawn(process.execPath, ['--import', ${JSON.stringify(loader)}, ${JSON.stringify(entry)}], {
        stdio: ['ignore', 'inherit', 'inherit'], env: process.env
      });
      process.on('SIGTERM', () => child.kill('SIGTERM'));
      child.on('error', (error) => { console.error(error); process.exit(1); });
      child.on('exit', (code) => process.exit(code ?? 1));
    `,
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
        CONCH_HOME: home,
        CONCH_SUPERVISE: '1',
        CONCH_SUPERVISED: '1',
        CONCH_STARTED_BECAUSE: 'restart',
      };
      delete env.CONCH_APP;
      delete env.CONCH_RELEASE_ROOT;
      delete env.CONCH_SUPERVISOR_ROOT;
      let child: ChildProcess | undefined;
      let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
      let output = '';
      let buffer = '';
      const events: LaunchEvent[] = [];
      try {
        child = spawn(process.execPath, [legacyEntry], {
          cwd,
          env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolveExit, reject) => {
            child?.once('error', reject);
            child?.once('exit', (code, signal) => resolveExit({ code, signal }));
          },
        );
        child.stdout?.on('data', (data: Buffer) => {
          output = (output + data.toString()).slice(-16_000);
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines)
            if (line.startsWith(PREFIX))
              events.push(JSON.parse(line.slice(PREFIX.length)) as LaunchEvent);
        });
        child.stderr?.on('data', (data: Buffer) => {
          output = (output + data.toString()).slice(-16_000);
        });
        const first = await eventually(
          () => events.find((event) => event.role === 'gateway' && event.sequence === 1),
          () => output,
        );
        const replacement = await eventually(
          () => events.find((event) => event.role === 'gateway' && event.sequence === 2),
          () => output,
        );
        const adopter = events.find((event) => event.role === 'adopter');
        expect(adopter).toMatchObject({ ipc: false, adopt: true, ppid: child.pid });
        expect(events.filter((event) => event.role === 'adopter')).toHaveLength(1);
        expect(first).toMatchObject({
          ipc: true,
          adopt: false,
          reason: 'restart',
          ppid: adopter?.pid,
        });
        expect(replacement).toMatchObject({
          ipc: true,
          adopt: false,
          reason: 'crash',
          ppid: adopter?.pid,
        });
        expect(replacement.pid).not.toBe(first.pid);
        expect(events.some((event) => event.role === 'frozen' && event.pid === first.pid)).toBe(
          true,
        );
        expect(alive(first.pid)).toBe(false);
        child.kill('SIGTERM');
        const exit = await Promise.race([
          exited,
          delay(5000).then(() => {
            throw new Error(`Shutdown did not finish:\n${output}`);
          }),
        ]);
        expect(exit).toEqual({ code: 0, signal: null });
        expect(
          events.some((event) => event.role === 'stopping' && event.pid === replacement.pid),
        ).toBe(true);
        for (const event of events) expect(alive(event.pid)).toBe(false);
      } finally {
        if (child?.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* Fixture already exited. */
          }
        }
        if (exited) await Promise.race([exited.catch(() => undefined), delay(2000)]);
        await rm(home, { recursive: true, force: true });
      }
    },
  );
});

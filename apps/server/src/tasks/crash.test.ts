import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskOperation } from '@conch/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const message = z.object({
  checkpoint: z.string().optional(),
  done: z.boolean().optional(),
  count: z.number().optional(),
  verified: z.boolean().optional(),
  error: z.string().optional(),
  operations: z.array(TaskOperation),
});
const fixture = fileURLToPath(new URL('./fixtures/crash.ts', import.meta.url));
function launch(home: string, stage: string) {
  const child = fork(fixture, [home, stage], {
    execArgv: ['--import', 'tsx'],
    silent: true,
    env: { ...process.env, TSX_DISABLE_CACHE: '1' },
  });
  let stderr = '';
  child.stderr?.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-2000);
  });
  const received = new Promise<z.infer<typeof message>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Fixture timed out: ${stderr}`));
    }, 10_000);
    child.once('message', (value) => {
      clearTimeout(timeout);
      const parsed = message.safeParse(value);
      if (parsed.success) resolve(parsed.data);
      else reject(parsed.error);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture exited ${code ?? signal}: ${stderr}`));
    });
  });
  return { child, received };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

describe('durable task effects through actual process death', () => {
  it.each(['before-effect', 'after-effect', 'after-receipt'])(
    'recovers %s without dispatching a duplicate',
    async (stage) => {
      const home = await mkdtemp(join(tmpdir(), 'conch-task-crash-'));
      const children: ChildProcess[] = [];
      try {
        const first = launch(home, stage);
        children.push(first.child);
        const checkpoint = await first.received;
        expect(checkpoint.checkpoint).toBe(stage);
        expect(checkpoint.operations).toHaveLength(1);
        await stop(first.child);
        const second = launch(home, 'resume');
        children.push(second.child);
        const resumed = await second.received;
        expect(resumed.done).toBe(true);
        expect(resumed.operations).toHaveLength(1);
        expect(resumed.operations[0]?.id).toBe(checkpoint.operations[0]?.id);
        if (stage === 'before-effect') {
          expect(resumed.count).toBe(0);
          expect(resumed.verified).toBe(false);
          expect(resumed.error).toMatch(/may already have happened/);
        } else {
          expect(resumed.count).toBe(1);
          expect(resumed.verified).toBe(true);
          expect(resumed.error).toBeUndefined();
        }
      } finally {
        await Promise.all(children.map(stop));
        await rm(home, { recursive: true, force: true });
      }
    },
    25_000,
  );
});

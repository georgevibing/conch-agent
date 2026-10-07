/** Isolated process-death fixture: only its supplied temporary home is touched. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostTool } from '../../engines/types';
import { syncFile } from '../../lib/fs';
import { TaskOperations, verifiedOutcome } from '../operations';
import { TaskStore } from '../store';

const [home, stage] = process.argv.slice(2);
if (!home || !stage) throw new Error('Missing fixture arguments');
const store = new TaskStore(home);
const effect = join(home, 'effect.json');
const get = async () => {
  const task = await store.get('task_crash');
  if (!task) throw new Error('Missing fixture task');
  return task;
};
if (stage !== 'resume')
  await store.save({
    id: 'task_crash',
    title: 'Fixture',
    prompt: 'Fixture',
    kind: 'background',
    status: 'running',
    createdAt: 1,
    options: {},
    steps: [],
    rev: 0,
    expectations: [{ tool: 'fixture_write', minimum: 1 }],
  });
const pause = async () => {
  process.send?.({ checkpoint: stage, operations: (await get()).operations });
  await new Promise<void>(() => {
    setInterval(() => {}, 60_000);
  });
};
const ledger = new TaskOperations(
  get,
  async (change) => {
    const task = await get();
    return store.save({ ...task, ...change(task) });
  },
  () => false,
);
const tool: HostTool = {
  name: 'fixture_write',
  description: 'Local fake provider',
  input: {},
  run: async (_args, context) => {
    if (stage === 'before-effect') await pause();
    const previous = await readFile(effect, 'utf8').then(
      (s) => JSON.parse(s) as { count: number },
      () => ({ count: 0 }),
    );
    await writeFile(
      effect,
      JSON.stringify({ id: context?.operationId, count: previous.count + 1 }),
    );
    await syncFile(effect);
    if (stage === 'after-effect') await pause();
    return 'saved';
  },
  verification: {
    effect: 'write',
    scope: async () => ({
      account: 'fake-provider',
      authorization: 'fixture',
      expiresAt: Number.MAX_SAFE_INTEGER,
    }),
    reconcile: async (_args, id) => {
      const saved = await readFile(effect, 'utf8').then(
        (s) => JSON.parse(s) as { id: string },
        () => undefined,
      );
      return saved?.id === id
        ? { state: 'confirmed', receipt: { provider: 'fixture', id, label: 'Saved fixture' } }
        : { state: 'absent' };
    },
  },
};
let error: string | undefined;
try {
  await ledger.wrap(tool).run({});
} catch (caught) {
  error = caught instanceof Error ? caught.message : 'failed';
}
if (stage === 'after-receipt') await pause();
const count = await readFile(effect, 'utf8').then(
  (s) => (JSON.parse(s) as { count: number }).count,
  () => 0,
);
process.send?.(
  {
    done: true,
    count,
    verified: verifiedOutcome(await get()),
    operations: (await get()).operations,
    ...(error && { error }),
  },
  () => process.disconnect?.(),
);

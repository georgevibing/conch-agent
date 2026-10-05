import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageData, checkPageData } from './page-data';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function directory() {
  const d = await mkdtemp(join(tmpdir(), 'conch-page-'));
  dirs.push(d);
  return d;
}
const query = { tool: 'read_day', input: { date: '2026-10-05' }, mode: 'read' as const };
const outcome = { ok: true, text: 'Today', json: { energy: 357 } };

describe('host-owned app page data', () => {
  it('persists preferences across hosts, isolates apps and refuses path keys and oversized values', async () => {
    const a = await directory(),
      b = await directory();
    await new PageData().state(a, 'v1', { op: 'set', key: 'selected-day', value: 'today' });
    expect(await new PageData().state(a, 'v2', { op: 'get', key: 'selected-day' })).toBe('today');
    expect(await new PageData().state(b, 'v1', { op: 'get', key: 'selected-day' })).toBeNull();
    await expect(
      new PageData().state(a, 'v1', { op: 'set', key: '../other', value: 1 }),
    ).rejects.toThrow();
    await expect(
      new PageData().state(a, 'v1', { op: 'set', key: 'large', value: 'x'.repeat(65536) }),
    ).rejects.toThrow('64 KB');
    await expect(
      new PageData().state(a, 'v1', { op: 'set', key: 'unicode', value: '🐚'.repeat(20000) }),
    ).rejects.toThrow('64 KB');
    await expect(
      new PageData().state(a, 'v1', { op: 'set', key: '__proto__', value: { polluted: true } }),
    ).rejects.toThrow();
    expect({}).not.toHaveProperty('polluted');
  });

  it('persists successful reads and freshness, uses canonical inputs and keeps success after failures', async () => {
    const dir = await directory();
    const pages = new PageData();
    let time = 1000;
    const run = vi.fn(async () => outcome);
    expect(await pages.query(dir, 'v1', query, 60, run, () => time)).toMatchObject({
      value: outcome,
      stale: false,
      at: 1000,
    });
    await new PageData().query(dir, 'v1', query, 60, run, () => time);
    expect(run).toHaveBeenCalledTimes(1);
    time += 61000;
    const failed = await pages.query(
      dir,
      'v1',
      query,
      60,
      async () => ({ ok: false, text: 'Offline' }),
      () => time,
    );
    expect(failed).toMatchObject({ value: { ok: false }, stale: true });
    expect(
      await pages.query(dir, 'v1', { ...query, mode: 'peek' }, 60, run, () => time),
    ).toMatchObject({ value: outcome, stale: true, at: 1000 });
    expect(await pages.query(dir, 'v2', { ...query, mode: 'peek' }, 60, run)).toMatchObject({
      value: null,
    });
    await pages.query(dir, 'v1', { ...query, input: { a: 1, b: 2 } }, 60, run, () => time);
    await pages.query(dir, 'v1', { ...query, input: { b: 2, a: 1 } }, 60, run, () => time);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent reads and never saves or returns a result from before an invalidation', async () => {
    const dir = await directory();
    const pages = new PageData();
    let resolve!: (v: typeof outcome) => void;
    const run = vi.fn(
      () =>
        new Promise<typeof outcome>((r) => {
          resolve = r;
        }),
    );
    const first = pages.query(dir, 'v1', query, 60, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const second = pages.query(dir, 'v1', query, 60, run);
    await pages.invalidate(dir, 'v1', true);
    resolve(outcome);
    expect(await first).toMatchObject({ value: null, stale: true });
    await second;
    expect(run).toHaveBeenCalledTimes(1);
    expect(await pages.query(dir, 'v1', { ...query, mode: 'peek' }, 60, run)).toMatchObject({
      value: null,
    });
  });

  it('does not cache setup-only responses, clears account state, and tolerates malformed storage', async () => {
    const dir = await directory();
    const pages = new PageData();
    await pages.query(dir, 'v1', query, 60, async () => ({
      ok: true,
      text: 'Setup',
      json: { setup_required: true },
    }));
    expect(
      await pages.query(dir, 'v1', { ...query, mode: 'peek' }, 60, async () => outcome),
    ).toMatchObject({ value: null });
    await pages.state(dir, 'v1', { op: 'set', key: 'date', value: 'today' });
    await pages.invalidate(dir, 'v1', true);
    expect(await pages.state(dir, 'v1', { op: 'get', key: 'date' })).toBeNull();
    await writeFile(join(dir, '.page-data.json'), '{broken');
    expect(await pages.state(dir, 'v1', { op: 'get', key: 'date' })).toBeNull();
  });
});

it('Repair everything detects malformed page data and keeps a copy before resetting it', async () => {
  const dir = await directory();
  await writeFile(join(dir, '.page-data.json'), '{broken');
  expect(await checkPageData(dir, 'v1', false)).toBe('damaged');
  expect(await checkPageData(dir, 'v1', true)).toBe('fixed');
  expect(await readFile(join(dir, '.page-data.bad'), 'utf8')).toBe('{broken');
  expect(await checkPageData(dir, 'v1', false)).toBe('ok');
});

import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { PAGE_DATA_BRIDGE } from './page-bridge';

interface Result {
  ok: boolean;
  json?: unknown;
  stale?: boolean;
  refreshing?: boolean;
  error?: string;
  message?: string;
}
interface Observer {
  stop(): void;
  refresh(): void;
}
const saved = (energy: number, stale: boolean) => ({
  ok: true,
  json: { value: { ok: true, text: 'Day', json: { energy } }, at: 1000, stale },
});
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());
function bridge(q: (tool: string, input: Record<string, unknown>) => Promise<unknown>) {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const api = runInNewContext(`${PAGE_DATA_BRIDGE}\n({observe,query,state,refreshQueries})`, {
    q,
    document,
    window,
    setTimeout,
    clearTimeout,
  }) as {
    observe(
      tool: string,
      input: Record<string, unknown>,
      options: { every: number },
      callback: (result: Result) => void,
    ): Observer;
    refreshQueries(): void;
    state: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  };
  return { ...api, document, window };
}
it('shows saved data before the refresh completes and preserves it on offline errors', async () => {
  vi.useFakeTimers();
  let resolve!: (v: unknown) => void;
  const q = vi.fn(async (_tool, input) =>
    input.mode === 'peek'
      ? saved(357, true)
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const api = bridge(q);
  const seen: Result[] = [];
  const observer = api.observe('read_day', {}, { every: 60 }, (r) => seen.push(r));
  await flush();
  expect(seen).toEqual([expect.objectContaining({ json: { energy: 357 }, refreshing: true })]);
  resolve({ ok: false, message: 'Offline' });
  await flush();
  expect(seen.at(-1)).toMatchObject({
    ok: true,
    json: { energy: 357 },
    stale: true,
    refreshing: false,
    error: 'Offline',
  });
  api.document.visibilityState = 'hidden';
  api.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(180000);
  expect(q).toHaveBeenCalledTimes(2);
  api.document.visibilityState = 'visible';
  api.document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(q).toHaveBeenCalledTimes(4);
  observer.stop();
  resolve(saved(500, false));
  await flush();
  expect(seen.at(-1)?.json).toEqual({ energy: 357 });
});
it('autoloads, listens for host invalidation, refreshes manually and cleans up listeners and timers', async () => {
  vi.useFakeTimers();
  let stale = false;
  const q = vi.fn(async (_tool, input) => {
    const reply = saved(357, stale);
    if (input.mode !== 'peek') stale = false;
    return reply;
  });
  const api = bridge(q);
  const render = vi.fn();
  const observer = api.observe('read_day', {}, { every: 60 }, render);
  await flush();
  expect(q).toHaveBeenCalledTimes(1);
  stale = true;
  api.refreshQueries();
  await flush();
  expect(q).toHaveBeenCalledTimes(3);
  observer.refresh();
  await flush();
  expect(q).toHaveBeenCalledTimes(5);
  observer.stop();
  api.refreshQueries();
  api.window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(300000);
  expect(q).toHaveBeenCalledTimes(5);
});
it('saves preferences through the host and reports a refused capability', async () => {
  const q = vi.fn(async (_tool, input) =>
    input.op === 'get' ? { ok: true, json: 'today' } : { ok: false, message: 'Not declared' },
  );
  const api = bridge(q);
  expect(await api.state.get('date')).toBe('today');
  await expect(api.state.set('date', 'yesterday')).rejects.toThrow('Not declared');
  expect(q.mock.calls[0]).toEqual(['__state', { op: 'get', key: 'date' }]);
});

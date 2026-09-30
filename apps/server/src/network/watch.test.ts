import type { NetworkStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { NetworkWatch, reachable } from './watch';

describe('is Conch online?', () => {
  it('counts any answer as online, and only no answer at all as offline', async () => {
    const answers = async () => new Response(null, { status: 401 });
    expect(await reachable(answers as typeof fetch, ['https://a', 'https://b'])).toBe(true);
    const oneDown: typeof fetch = async (url) => {
      if (String(url).includes('a')) throw new TypeError('fetch failed');
      return new Response(null, { status: 204 });
    };
    expect(await reachable(oneDown, ['https://a', 'https://b'])).toBe(true);
    const none: typeof fetch = async () => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    };
    expect(await reachable(none, ['https://a', 'https://b'])).toBe(false);
  });

  it('says so when it changes, once', async () => {
    let up = true;
    const told: NetworkStatus[] = [];
    const heard: boolean[] = [];
    const watch = new NetworkWatch({
      emit: (s) => told.push(s),
      probe: async () => up,
      now: () => 1000,
    });
    watch.onChange((s) => heard.push(s.online));
    await watch.check();
    expect(told).toEqual([]);
    up = false;
    await watch.check();
    await watch.check();
    up = true;
    await watch.check();
    expect(told).toEqual([
      { online: false, since: 1000 },
      { online: true, since: 1000 },
    ]);
    expect(heard).toEqual([false, true]);
    watch.stop();
  });

  it('asks once however many ask at the same time', async () => {
    let probes = 0;
    const watch = new NetworkWatch({
      emit: () => undefined,
      probe: async () => {
        probes++;
        await new Promise((r) => setTimeout(r, 20));
        return false;
      },
    });
    await Promise.all([watch.check(), watch.check(), watch.check()]);
    expect(probes).toBe(1);
    expect(watch.online).toBe(false);
    watch.stop();
  });
});

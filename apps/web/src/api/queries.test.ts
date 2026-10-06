import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { keys, refreshCapabilities } from './queries';

describe('refreshCapabilities', () => {
  it('replaces a catalog asked for before the change, even while that answer is still in flight', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let asked = 0;
    let answerFirst: (models: string) => void = () => undefined;
    const queryFn = () => {
      asked++;
      return asked === 1
        ? new Promise<string>((resolve) => (answerFirst = resolve))
        : Promise.resolve('with the new server');
    };
    const observer = new QueryObserver(client, {
      queryKey: keys.models,
      queryFn,
      staleTime: 10 * 60_000,
    });
    const stop = observer.subscribe(() => undefined);
    expect(asked).toBe(1);

    // A server was just added, while the page's first catalog is still being listed.
    await refreshCapabilities(client);
    expect(asked).toBe(2);
    expect(client.getQueryData(keys.models)).toBe('with the new server');

    // The answer from before the change lands late and is left where it fell.
    answerFirst('without it');
    await Promise.resolve();
    expect(client.getQueryData(keys.models)).toBe('with the new server');
    stop();
  });
});

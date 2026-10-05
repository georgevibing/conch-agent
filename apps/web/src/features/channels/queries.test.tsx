import type { Channel, ChannelList, ServerEvent } from '@conch/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { channelsApi } from './api';
import { applyChannelEvent, channelKeys, useChannels } from './queries';

afterEach(() => vi.restoreAllMocks());

const channel: Channel = {
  id: 'ch_mail',
  kind: 'email',
  enabled: true,
  createdAt: 1,
  bot: { id: 'mail', name: 'ada@example.com' },
  people: [],
  requests: [],
  blocked: 0,
  groups: [],
  settings: { notifyRoutines: true },
  health: { state: 'reconnecting', since: 1 },
};

describe.each(['initial load', 'refetch'] as const)('channel events during %s', (phase) => {
  it.each(['changed', 'deleted'] as const)(
    'keeps a channel.%s event when an older fetch finishes',
    async (kind) => {
      const snapshot: ChannelList = { channels: [channel], catalog: [] };
      let finish!: (list: ChannelList) => void;
      const pending = new Promise<ChannelList>((resolve) => {
        finish = resolve;
      });
      const fetch = vi.spyOn(channelsApi, 'list').mockReturnValue(pending);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      if (phase === 'refetch') client.setQueryData(channelKeys.all, snapshot, { updatedAt: 0 });
      const { result, unmount } = renderHook(() => useChannels(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const changed: Channel = { ...channel, health: { state: 'needs-token', since: 2 } };
      const event: ServerEvent =
        kind === 'changed'
          ? { type: 'channel.changed', channel: changed }
          : { type: 'channel.deleted', channelId: channel.id };
      act(() => applyChannelEvent(client, event, () => undefined));
      await act(async () => {
        finish(snapshot);
        await pending;
      });
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(result.current.data?.channels).toEqual(kind === 'changed' ? [changed] : []);
      unmount();
      client.clear();
    },
  );
});

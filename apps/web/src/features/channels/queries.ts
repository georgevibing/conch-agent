import type { Channel, ChannelLink, ChannelList, ServerEvent } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { channelsApi } from './api';

export const channelKeys = { all: ['channels'] as const };

export const linkKey = (id: string) => ['channel-link', id] as const;

/**
 * A code being shown to link WhatsApp or Signal, kept current by the live
 * socket (`channel.link`), and asked for again now and then in case an
 * event was missed.
 */
export function useChannelLink(id: string | undefined) {
  return useQuery({
    queryKey: linkKey(id ?? ''),
    queryFn: () => channelsApi.linkStatus(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'linked' ||
        state === 'expired' ||
        state === 'failed' ||
        state === 'needs-install'
        ? false
        : 5_000;
    },
  });
}

export function useChannels() {
  return useQuery({ queryKey: channelKeys.all, queryFn: channelsApi.list, staleTime: 30_000 });
}

export function useChannel(id: string | undefined) {
  const list = useChannels();
  return { ...list, channel: list.data?.channels.find((c) => c.id === id) };
}

export function putChannel(client: QueryClient, channel: Channel) {
  client.setQueryData<ChannelList>(channelKeys.all, (data) => {
    if (!data) return data;
    const exists = data.channels.some((c) => c.id === channel.id);
    return {
      ...data,
      channels: exists
        ? data.channels.map((c) => (c.id === channel.id ? channel : c))
        : [...data.channels, channel],
    };
  });
}

/**
 * Channel events from the live socket keep every open view current. Someone
 * new asking to talk is worth a quiet toast, with a way to answer.
 */
export function applyChannelEvent(
  client: QueryClient,
  event: Extract<ServerEvent, { type: `channel.${string}` }>,
  navigate: (to: string) => void,
) {
  if (event.type === 'channel.link') {
    client.setQueryData<ChannelLink>(linkKey(event.link.id), event.link);
    return;
  }
  if (event.type === 'channel.deleted') {
    client.setQueryData<ChannelList>(channelKeys.all, (data) =>
      data ? { ...data, channels: data.channels.filter((c) => c.id !== event.channelId) } : data,
    );
    return;
  }
  const before = client
    .getQueryData<ChannelList>(channelKeys.all)
    ?.channels.find((c) => c.id === event.channel.id);
  if (!client.getQueryData(channelKeys.all)) {
    void client.invalidateQueries({ queryKey: channelKeys.all });
    return;
  }
  putChannel(client, event.channel);
  // A new request from someone, once there's an owner (the owner's own hello is on screen already).
  const fresh = event.channel.requests.filter((r) => !before?.requests.some((b) => b.id === r.id));
  if (before && fresh.length && event.channel.people.length > 0) {
    const [first] = fresh;
    if (first)
      toast(`${first.name} wants to talk to your assistant`, {
        description: first.preview || undefined,
        action: { label: 'Review', onClick: () => navigate(`/channels/${event.channel.id}`) },
      });
  }
}

export const errorText = (error: unknown, fallback = 'Something went wrong.') =>
  error instanceof ApiError ? error.message : fallback;

/** Change a channel and put the answer in the cache, saying so when it fails. */
export function useChannelAction<A extends unknown[]>(
  fn: (...args: A) => Promise<Channel>,
  failure = 'That didn’t work.',
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: (channel) => putChannel(client, channel),
    onError: (error) => {
      // "Confirm it's you" opens its own dialog; a toast on top would say it twice.
      if (error instanceof ApiError && error.code === 'verify-required') return;
      toast.error(errorText(error, failure));
    },
  });
}

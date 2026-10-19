import type { RelayView } from '@conch/protocol';
import { AlwaysOnRelay, Skeleton, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import { channelKeys, errorText, useRelay } from './queries';

/**
 * The always-on relay (ADR 0140), beside the public door: one press makes
 * this computer's key and shows the command for each place the relay can
 * run; pasting its address makes every public address Conch hands out the
 * relay's. Setting it up changes where the internet reaches Conch, so from
 * another device it asks you to confirm it's you first.
 */
export function RelayStep() {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: relay } = useRelay();
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string>();

  const act = async (fn: () => Promise<RelayView>) => {
    setBusy(true);
    setConnectError(undefined);
    try {
      await guard(async () => {
        client.setQueryData(channelKeys.relay, await fn());
        await client.invalidateQueries({ queryKey: channelKeys.door });
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'verify-required') return;
      if (error instanceof ApiError && error.code === 'invalid') setConnectError(error.message);
      else toast.error(errorText(error, 'That didn’t work.'));
    } finally {
      setBusy(false);
    }
  };

  if (!relay) return <Skeleton shape="block" height="5rem" />;
  return (
    <>
      <AlwaysOnRelay
        id="relay"
        state={relay.state}
        {...(relay.url && { url: relay.url })}
        {...(relay.setup && { setup: relay.setup })}
        {...(relay.depth !== undefined && { waiting: relay.depth })}
        {...(relay.message && { message: relay.message })}
        busy={busy}
        onPair={() => void act(channelsApi.relayPair)}
        onConnect={(url) => void act(() => channelsApi.relayConnect(url))}
        onCheck={() => void act(channelsApi.relayCheck)}
        onForget={() => void act(channelsApi.relayForget)}
        {...(connectError && { connectError })}
      />
      {dialog}
    </>
  );
}

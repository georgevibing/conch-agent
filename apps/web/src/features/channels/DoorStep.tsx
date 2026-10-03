import type { ChannelDoor } from '@conch/protocol';
import { PublicDoor, Skeleton, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { GetIt } from '../setup/GetIt';
import { channelsApi } from './api';
import { APPS } from './describe';
import { channelKeys, errorText, useDoor } from './queries';

/**
 * The public address Teams and WeChat deliver to (ADR 0045), as one card:
 * turn it on with Tailscale (installing it first when it's missing), or use
 * an address of your own; and when it waits for something only you can do,
 * that one step. Opening it is a trust decision, so from another device it
 * asks you to confirm it's you first.
 */
export function DoorStep() {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: door } = useDoor();
  const [busy, setBusy] = useState(false);
  const [ownError, setOwnError] = useState<string>();
  const put = (next: ChannelDoor) => client.setQueryData(channelKeys.door, next);

  // Waiting on Tailscale's own page: look again when you come back to this one.
  useEffect(() => {
    if (door?.state !== 'starting' && door?.state !== 'needs-you') return;
    const look = () => void channelsApi.doorCheck().then(put, () => undefined);
    const timer = setInterval(look, 5_000);
    window.addEventListener('focus', look);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', look);
    };
  });

  const act = async (fn: () => Promise<ChannelDoor>) => {
    setBusy(true);
    setOwnError(undefined);
    try {
      await guard(async () => put(await fn()));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'verify-required') return;
      if (error instanceof ApiError && error.code === 'invalid') setOwnError(error.message);
      else toast.error(errorText(error, 'That didn’t work.'));
    } finally {
      setBusy(false);
    }
  };

  if (!door) return <Skeleton shape="block" height="7rem" />;
  const apps = door.apps.length ? door.apps.map((kind) => APPS[kind].name) : ['Teams', 'WeChat'];
  return (
    <>
      <PublicDoor
        state={door.state}
        apps={apps}
        {...(door.url && { url: door.url })}
        {...(door.via && { via: door.via })}
        {...(door.address && { conchAddress: door.address })}
        {...(door.message && { message: door.message })}
        {...(door.problem && { problem: door.problem })}
        install={
          door.problem?.kind === 'need' && door.problem.need ? (
            <GetIt needId={door.problem.need} name="Tailscale" />
          ) : undefined
        }
        busy={busy}
        onTailscale={() => void act(channelsApi.doorTailscale)}
        onConchAddress={() => void act(channelsApi.doorAddress)}
        onOwn={(url) => void act(() => channelsApi.doorOwn(url))}
        onOff={() => void act(channelsApi.doorOff)}
        onCheck={() =>
          void act(async () => {
            const now = await channelsApi.doorCheck();
            if (now.state === 'ready' && now.checkedAt)
              toast.success('It answers from the internet.');
            return now;
          })
        }
        {...(ownError && { ownError })}
      />
      {dialog}
    </>
  );
}

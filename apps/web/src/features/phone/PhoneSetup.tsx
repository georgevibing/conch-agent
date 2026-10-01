import type { PhoneAddress } from '@conch/protocol';
import { Button, Callout, CopyButton, SetupChecklist, Stack, Text } from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { keys } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { useNeed } from '../setup/useNeed';
import { phoneApi, phoneKeys } from './api';

const PHONE_APPS = {
  ios: 'https://apps.apple.com/app/tailscale/id1470499037',
  android: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn',
};

/** Where the secure address stands, looked at again every couple of seconds until it's on. */
export function usePhoneAddress(enabled = true) {
  return useQuery({
    queryKey: phoneKeys.address,
    queryFn: phoneApi.address,
    enabled,
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) => (q.state.data?.state === 'ready' ? false : 2_000),
  });
}

/**
 * Your phone's secure address, as one short checklist that fills in by
 * itself (ADR 0027): Tailscale on this computer, signed in, the address on,
 * Tailscale on your phone. Each step has one button; the one only you can
 * take (an OK on Tailscale's page) says which page, and Conch carries on as
 * soon as you've pressed it.
 */
export function PhoneSetup({ onReady }: { onReady?: () => void }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: address } = usePhoneAddress();
  const tailscale = useNeed('tailscale');
  const [turning, setTurning] = useState(false);
  const [failure, setFailure] = useState<string>();

  const ready = address?.state === 'ready';
  useEffect(() => {
    if (!ready) return;
    // The new address joins the ones Add a device offers.
    void client.invalidateQueries({ queryKey: keys.access });
    onReady?.();
  }, [ready, client, onReady]);

  if (!address) return null;

  const turnOn = async () => {
    setFailure(undefined);
    setTurning(true);
    try {
      await guard(async () => {
        client.setQueryData<PhoneAddress>(phoneKeys.address, await phoneApi.turnOn());
      });
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'That didn’t work. Try again.');
    } finally {
      setTurning(false);
    }
  };

  const installed = address.state !== 'missing';
  const signedIn = installed && address.state !== 'stopped' && address.state !== 'signed-out';
  const problem = address.problem;

  return (
    <Stack gap={4}>
      <SetupChecklist aria-label="What your phone needs to reach Conch">
        <SetupChecklist.Step
          state={installed ? 'done' : 'current'}
          title="Tailscale on this computer"
          description={
            installed
              ? undefined
              : 'Free and encrypted. Only your own devices can reach Conch, and nothing is opened to the internet.'
          }
          note={installed ? 'Installed' : undefined}
          action={
            installed ? undefined : (
              <Button
                size="sm"
                trailingIcon={<ArrowUpRight />}
                onClick={() => void tailscale.act('install')}
                asChild={Boolean(tailscale.need?.download)}
              >
                {tailscale.need?.download ? (
                  <a href={tailscale.need.download} target="_blank" rel="noreferrer noopener">
                    Get Tailscale
                  </a>
                ) : (
                  'Get Tailscale'
                )}
              </Button>
            )
          }
        />
        <SetupChecklist.Step
          state={signedIn ? 'done' : installed ? 'current' : 'waiting'}
          title="Signed in to Tailscale"
          description={
            installed && !signedIn
              ? address.state === 'stopped'
                ? 'Open Tailscale and sign in. Conch notices by itself.'
                : 'Sign in to Tailscale on this computer. Conch notices by itself.'
              : undefined
          }
          note={signedIn ? address.name : undefined}
          action={
            installed && !signedIn ? (
              <Button size="sm" variant="surface" onClick={() => void tailscale.act('open')}>
                Open Tailscale
              </Button>
            ) : undefined
          }
        />
        <SetupChecklist.Step
          state={
            ready
              ? 'done'
              : !signedIn
                ? 'waiting'
                : turning || (address.waiting && !problem)
                  ? 'working'
                  : problem && problem.kind !== 'enable-https'
                    ? 'failed'
                    : 'current'
          }
          title="A secure address for Conch"
          description={
            ready ? undefined : problem ? (
              <Stack gap={2}>
                <span>{problem.message}</span>
                {problem.command && (
                  <span>
                    <code>{problem.command}</code>{' '}
                    <CopyButton value={problem.command} label="Copy command" />
                  </span>
                )}
              </Stack>
            ) : signedIn ? (
              'One press. Your devices reach it at its own https address, with a real certificate.'
            ) : undefined
          }
          note={ready ? address.url?.replace(/^https:\/\//, '') : undefined}
          progress={turning ? { label: 'Turning it on' } : undefined}
          action={
            !signedIn || ready ? undefined : problem?.url ? (
              <Button size="sm" asChild trailingIcon={<ArrowUpRight />}>
                <a href={problem.url} target="_blank" rel="noreferrer noopener">
                  Open Tailscale’s page
                </a>
              </Button>
            ) : (
              <Button
                size="sm"
                leadingIcon={<LockKeyhole />}
                loading={turning}
                onClick={() => void turnOn()}
              >
                Turn on
              </Button>
            )
          }
        />
        <SetupChecklist.Step
          state={ready ? 'current' : 'waiting'}
          title="Tailscale on your phone"
          description={
            <>
              Get it from the{' '}
              <a href={PHONE_APPS.ios} target="_blank" rel="noreferrer noopener">
                App Store
              </a>{' '}
              or{' '}
              <a href={PHONE_APPS.android} target="_blank" rel="noreferrer noopener">
                Google Play
              </a>
              , and sign in with the same account.
            </>
          }
        />
      </SetupChecklist>
      {failure && <Callout tone="danger">{failure}</Callout>}
      {problem?.kind === 'enable-https' && (
        <Text size="sm" tone="muted">
          Waiting for your OK on Tailscale’s page. This finishes by itself.
        </Text>
      )}
      {dialog}
      {tailscale.dialog}
    </Stack>
  );
}

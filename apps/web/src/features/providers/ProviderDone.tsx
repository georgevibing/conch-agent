import { Button, Heading, IntegrationHandshake, Pearl, Stack, Text } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { providersApi } from './api';
import styles from './Providers.module.css';
import { SIGN_IN_CHANNEL } from './useProviderSignIn';

const messages: Record<string, string> = {
  connected: 'You can close this window.',
  denied: 'You didn’t allow it, so nothing was connected.',
  expired: 'That sign-in took too long. Start again from Conch.',
  failed: 'Signing in didn’t work. Try again from Conch.',
};

/**
 * Where a provider's sign-in window lands: first while it's opening ("one
 * moment"), then after the provider sends you back. On success it says so and
 * closes itself — the Conch tab has already heard and moved on.
 */
export function ProviderDone() {
  const params = new URLSearchParams(window.location.search);
  const opening = params.has('opening');
  const id = params.get('provider') ?? '';
  const result = params.get('result') ?? 'failed';
  const ok = result === 'connected';

  const providers = useQuery({
    queryKey: ['providers-done'],
    queryFn: () => providersApi.list(),
    enabled: !opening,
    retry: false,
  });
  const provider = providers.data?.providers.find((p) => p.id === id);
  const name = provider?.name ?? 'That provider';

  // Tell the Conch tab now, so it moves on while this window is still saying so.
  useEffect(() => {
    if (opening || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    channel.postMessage({ provider: id, result });
    channel.close();
  }, [opening, id, result]);

  useEffect(() => {
    if (!ok || opening) return;
    const timer = setTimeout(() => window.close(), 1600);
    return () => clearTimeout(timer);
  }, [ok, opening]);

  useEffect(() => {
    document.title = opening ? 'Signing in… · Conch' : 'Conch';
  }, [opening]);

  if (opening) {
    return (
      <div className={styles.done}>
        <Stack gap={4} align="center">
          <Pearl size="lg" state="thinking" label="Opening the sign-in page" />
          <Text tone="muted">Opening the sign-in page…</Text>
        </Stack>
      </div>
    );
  }

  return (
    <div className={styles.done}>
      <Stack gap={4} align="center">
        <IntegrationHandshake
          name={name}
          brand={provider?.status.engine ?? id}
          color={provider?.color}
          phase={ok ? 'connected' : 'failed'}
        />
        <Heading level={1} size="xl" align="center">
          {ok ? `${name} is connected` : `${name} isn’t connected`}
        </Heading>
        <Text tone="muted" align="center">
          {messages[result] ?? messages.failed}
        </Text>
        <Button
          variant={ok ? 'surface' : 'solid'}
          onClick={() => {
            window.close();
            // Opened as a tab after all: go back into Conch instead.
            setTimeout(() => window.location.assign(`/?provider=${encodeURIComponent(id)}`), 150);
          }}
        >
          {ok ? 'Close' : 'Back to Conch'}
        </Button>
      </Stack>
    </div>
  );
}

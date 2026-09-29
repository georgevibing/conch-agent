import { Button, IntegrationHandshake, Pearl, Stack, Heading, Text } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { integrationsApi } from './api';
import styles from './Integrations.module.css';

/**
 * Where the sign-in window lands: first while it's opening ("one moment"),
 * then after the service sends you back. On success it says so and closes
 * itself; the Conch tab has already updated over the live connection.
 */
export function OAuthDone() {
  const params = new URLSearchParams(window.location.search);
  const opening = params.has('opening');
  const id = params.get('id') ?? undefined;
  const result = params.get('result') ?? 'failed';
  const integration = useQuery({
    queryKey: ['integration-done', id],
    queryFn: () => integrationsApi.get(id ?? ''),
    enabled: Boolean(id) && !opening,
    retry: false,
  });
  const list = useQuery({
    queryKey: ['integrations-done-catalog'],
    queryFn: integrationsApi.list,
    enabled: Boolean(id) && !opening,
    retry: false,
  });
  const entry = list.data?.catalog.find((c) => c.id === integration.data?.catalogId);
  const ok = result === 'connected';

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

  const name = integration.data?.name ?? 'The app';
  const message =
    result === 'connected'
      ? 'You can close this window.'
      : result === 'denied'
        ? 'You didn’t allow access, so nothing was connected.'
        : result === 'expired'
          ? 'This sign-in link expired. Start again from Conch.'
          : (integration.data?.health.message ?? 'Signing in didn’t work. Try again from Conch.');

  return (
    <div className={styles.done}>
      <Stack gap={4} align="center">
        <IntegrationHandshake
          name={name}
          brand={integration.data?.catalogId ?? 'custom'}
          color={entry?.color}
          phase={ok ? 'connected' : 'failed'}
        />
        <Heading level={1} size="xl" align="center">
          {ok ? `${name} is connected` : `${name} isn’t connected`}
        </Heading>
        <Text tone="muted" align="center">
          {message}
        </Text>
        <Button
          variant={ok ? 'surface' : 'solid'}
          onClick={() => {
            window.close();
            // Opened as a tab after all: go back into Conch instead.
            setTimeout(
              () => window.location.assign(id ? `/integrations/${id}` : '/integrations'),
              150,
            );
          }}
        >
          {ok ? 'Close' : 'Back to Conch'}
        </Button>
      </Stack>
    </div>
  );
}

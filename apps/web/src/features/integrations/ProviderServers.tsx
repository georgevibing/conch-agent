import type { ExternalIntegration } from '@conch/protocol';
import {
  Button,
  Collapsible,
  IntegrationLogo,
  IntegrationStatusBadge,
  Skeleton,
  Stack,
  Text,
  toast,
  META_SEP,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';

import { Section } from '../settings/Section';
import { integrationsApi } from './api';
import { sourceLabel } from './describe';
import styles from './Integrations.module.css';
import { integrationKeys, useExternal, useIntegrations } from './queries';
import { useSignIn } from './useSignIn';

/**
 * Settings → Providers → Set up inside a provider (ADR 0049). What a provider
 * set up by itself and Conch can't connect (a program in its settings, a
 * plugin, an account connector with no app of its own in Conch) only works
 * when that provider answers, so it's kept here, folded away, rather than on
 * the Integrations page. Everything Conch could connect itself is already
 * there; what you disconnected from Conch waits here with a way back.
 */
export function ProviderServers() {
  const { data } = useIntegrations();
  const providers = data?.providers ?? [];
  const asked = providers.some((p) => p.hasOwnServers);
  const external = useExternal(asked);
  const signIn = useSignIn();
  const client = useQueryClient();
  const catalog = data?.catalog ?? [];
  const servers = external.data?.servers ?? [];
  const message = external.data?.message;
  if (!asked || (!external.isPending && !servers.length && !message)) return null;

  const bringBack = (server: ExternalIntegration) =>
    void signIn((display) =>
      integrationsApi.adopt({ provider: server.provider, name: server.name }, display),
    ).then((result) => {
      if (!result) return;
      void client.invalidateQueries({ queryKey: integrationKeys.external });
      if (!result.authorizeUrl) toast.success(`${server.name} works with every model again.`);
    });

  const groups = providers
    .map((provider) => ({ provider, list: servers.filter((s) => s.provider === provider.id) }))
    .filter((g) => g.list.length > 0);
  const total = servers.length;

  return (
    <Section
      title="Set up inside a provider"
      description="These were set up in a provider’s own settings, and Conch can’t connect them itself, so they only work when that provider answers. Change them there."
    >
      <Collapsible className={styles.providerGroup}>
        <Collapsible.Trigger className={styles.providerTrigger}>
          <span className={styles.providerName}>
            {total === 1 ? '1 server' : `${total} servers`}
          </span>
          <Text as="span" size="xs" tone="subtle">
            {groups.map((g) => g.provider.engine).join(', ')}
          </Text>
        </Collapsible.Trigger>
        <Collapsible.Content>
          {external.isPending ? (
            <div className={styles.externalList}>
              <Skeleton shape="text" width="60%" />
              <Skeleton shape="text" width="45%" />
            </div>
          ) : (
            <Stack gap={3}>
              {groups.map(({ provider, list }) => (
                <ul
                  key={provider.id}
                  className={styles.externalList}
                  aria-label={`Set up in ${provider.engine}`}
                >
                  {list.map((server) => {
                    const entry = catalog.find((c) => c.id === server.catalogId);
                    return (
                      <li
                        key={`${server.source}:${server.plugin ?? ''}:${server.name}`}
                        className={styles.externalRow}
                      >
                        <IntegrationLogo
                          brand={server.catalogId}
                          name={server.name}
                          color={entry?.color}
                          size="sm"
                          decorative
                        />
                        <span className={styles.externalName}>
                          <Text as="span" size="sm" weight="medium">
                            {server.name}
                          </Text>
                          <Text as="span" size="xs" tone="subtle">
                            {server.plugin
                              ? `Plugin: ${server.plugin}`
                              : sourceLabel(server.source, provider)}
                            {`${META_SEP}only with ${provider.engine}`}
                            {server.state === 'ok' && server.toolCount
                              ? `${META_SEP}${server.toolCount} tools`
                              : ''}
                            {server.message ? `${META_SEP}${server.message}` : ''}
                          </Text>
                        </span>
                        {server.adoptable && (
                          <Button size="sm" variant="ghost" onClick={() => bringBack(server)}>
                            Use with every model
                          </Button>
                        )}
                        <IntegrationStatusBadge state={server.state} />
                      </li>
                    );
                  })}
                </ul>
              ))}
              {message && (
                <Text size="sm" tone="muted">
                  {message}
                </Text>
              )}
            </Stack>
          )}
        </Collapsible.Content>
      </Collapsible>
    </Section>
  );
}

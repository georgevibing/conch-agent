import type {
  CatalogEntry,
  ExternalIntegration,
  Integration,
  IntegrationProvider,
} from '@conch/protocol';
import {
  Button,
  Collapsible,
  Heading,
  Input,
  IntegrationCard,
  IntegrationLogo,
  IntegrationStatusBadge,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { Plus, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { ConnectDialog } from './ConnectDialog';
import { CustomDialog } from './CustomDialog';
import {
  categoryLabel,
  accountConnected,
  fixLabel,
  needsAttention,
  quietMeta,
  sourceLabel,
} from './describe';
import styles from './Integrations.module.css';
import { useAssistantName, useExternal, useIntegrations, useUpdateIntegration } from './queries';
import { useFix } from './useFix';

const results: Record<string, { tone: 'success' | 'error' | 'info'; text: string }> = {
  connected: { tone: 'success', text: 'Connected' },
  denied: { tone: 'info', text: 'You didn’t allow access, so nothing was connected.' },
  failed: { tone: 'error', text: 'Signing in didn’t work. Try again.' },
  expired: { tone: 'error', text: 'That sign-in link expired. Start again from here.' },
};

/** A sign-in that came back to this tab (popups blocked): say how it went, then tidy the URL. */
export function useSignInResult() {
  const [params, setParams] = useSearchParams();
  const result = params.get('result');
  useEffect(() => {
    if (!result) return;
    const r = results[result];
    if (r?.tone === 'success') toast.success(r.text);
    else if (r?.tone === 'error') toast.error(r.text);
    else if (r) toast(r.text);
    setParams({}, { replace: true });
  }, [result, setParams]);
}

function order(a: Integration, b: Integration) {
  const rank = (i: Integration) => (needsAttention(i) ? 0 : i.enabled ? 1 : 2);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

type Category = 'all' | CatalogEntry['category'];

/**
 * Integrations belong to Conch, not to a provider (ADR 0012): everything
 * connected here goes to every model you pick. What a provider set up by
 * itself is listed apart, folded away, and says it only works with that
 * provider.
 */
export function IntegrationsView() {
  useSignInResult();
  const { data, isPending } = useIntegrations();
  const providers = useMemo(() => data?.providers ?? [], [data]);
  const assistant = useAssistantName();
  const external = useExternal(providers.some((p) => p.hasOwnServers));
  const update = useUpdateIntegration();
  const { fix, pending } = useFix();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState<CatalogEntry>();
  const [custom, setCustom] = useState(false);
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');

  const integrations = useMemo(() => [...(data?.integrations ?? [])].sort(order), [data]);
  const catalog = useMemo(() => data?.catalog ?? [], [data]);
  const categories = useMemo(
    () => ['all', ...new Set(catalog.map((c) => c.category))] as Category[],
    [catalog],
  );
  const needle = query.trim().toLowerCase();
  const shown = catalog
    // Ones you've connected here live in "Connected" above.
    .filter((c) => !integrations.some((i) => i.catalogId === c.id))
    .filter((c) => category === 'all' || c.category === category)
    .filter(
      (c) =>
        !needle ||
        c.name.toLowerCase().includes(needle) ||
        c.tagline.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(b.featured) - Number(a.featured));

  // The provider whose own account brings the services that only admit approved apps.
  const accountProvider = providers.find((p) => p.account);

  /** What a tile says about a service a provider's account brings. It's never "connected" here. */
  const accountNote = (entry: CatalogEntry) => {
    if (entry.auth !== 'account' || !accountProvider?.account) return undefined;
    const found = accountConnected(external.data?.servers, entry);
    if (found?.state === 'ok') return `Only with ${accountProvider.engine} models`;
    if (found?.state === 'needs-auth') return `Reconnect in ${accountProvider.account.label}`;
    return `Through ${accountProvider.account.label}`;
  };

  const openEntry = (entry: CatalogEntry) => {
    const mine = integrations.find((i) => i.catalogId === entry.id);
    if (mine) void navigate(`/integrations/${mine.id}`);
    else setConnecting(entry);
  };

  // `?connect=notion` (from ⌘K) opens that app's connect dialog straight away.
  const [params, setParams] = useSearchParams();
  const connectId = params.get('connect');
  const linked = connectId
    ? catalog.find((c) => c.id === connectId && !integrations.some((i) => i.catalogId === c.id))
    : undefined;
  // Already connected: open it instead.
  useEffect(() => {
    if (!connectId) return;
    const mine = integrations.find((i) => i.catalogId === connectId);
    if (mine) void navigate(`/integrations/${mine.id}`, { replace: true });
  }, [connectId, integrations, navigate]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Integrations
          </Heading>
          <Text tone="muted">
            Connect your apps once — {assistant} can use them with every model you pick.
          </Text>
        </Stack>
        <Button variant="surface" leadingIcon={<Plus />} onClick={() => setCustom(true)}>
          Add your own
        </Button>
      </header>

      {isPending ? (
        <div className={styles.cards}>
          <Skeleton shape="block" height="5.5rem" />
          <Skeleton shape="block" height="5.5rem" />
        </div>
      ) : (
        integrations.length > 0 && (
          <section aria-labelledby="int-connected" className={styles.section}>
            <Heading level={2} id="int-connected" size="sm" tone="muted">
              Connected
            </Heading>
            <ul className={styles.cards}>
              {integrations.map((integration, index) => {
                const entry = catalog.find((c) => c.id === integration.catalogId);
                const label = fixLabel(integration);
                return (
                  <li key={integration.id}>
                    <IntegrationCard
                      variant="connected"
                      index={index}
                      name={integration.name}
                      brand={integration.catalogId ?? 'custom'}
                      color={entry?.color}
                      state={integration.health.state}
                      message={integration.health.message}
                      meta={quietMeta(integration)}
                      enabled={integration.enabled}
                      action={
                        label
                          ? {
                              label,
                              onClick: () => fix(integration),
                              loading: pending === integration.id,
                            }
                          : undefined
                      }
                      onToggle={(enabled) =>
                        update.mutate({ id: integration.id, patch: { enabled } })
                      }
                      onOpen={() => void navigate(`/integrations/${integration.id}`)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}

      <section aria-labelledby="int-catalog" className={styles.section}>
        <div className={styles.catalogHeader}>
          <Heading level={2} id="int-catalog" size="sm" tone="muted">
            {integrations.length ? 'Add another app' : 'Connect your first app'}
          </Heading>
          <div className={styles.filters}>
            {categories.length > 2 && (
              <SegmentedControl
                size="sm"
                value={category}
                onValueChange={(v) => setCategory(v as Category)}
                aria-label="Show"
              >
                {categories.map((c) => (
                  <SegmentedControl.Item key={c} value={c}>
                    {c === 'all' ? 'All' : categoryLabel[c]}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl>
            )}
            <Input
              size="sm"
              type="search"
              aria-label="Find an app"
              placeholder="Find an app"
              leading={<Search />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.search}
            />
          </div>
        </div>
        {isPending ? (
          <div className={styles.tiles}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} shape="block" height="4.25rem" />
            ))}
          </div>
        ) : shown.length ? (
          <ul className={styles.tiles}>
            {shown.map((entry, index) => (
              <li key={entry.id}>
                <IntegrationCard
                  variant="catalog"
                  index={index}
                  name={entry.name}
                  brand={entry.id}
                  color={entry.color}
                  tagline={entry.tagline}
                  local={entry.local}
                  note={accountNote(entry)}
                  connected={false}
                  onOpen={() => openEntry(entry)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Stack gap={2} align="start" className={styles.noMatch}>
            <Text tone="muted">Nothing called “{query}” here yet.</Text>
            <Button
              variant="surface"
              size="sm"
              leadingIcon={<Plus />}
              onClick={() => setCustom(true)}
            >
              Add it yourself
            </Button>
          </Stack>
        )}
      </section>

      <ProviderServers
        providers={providers}
        loading={providers.some((p) => p.hasOwnServers) && external.isPending}
        servers={(external.data?.servers ?? []).filter(
          // Account services already have a tile of their own above.
          (s) =>
            !(
              s.source === 'account' &&
              catalog.some((c) => c.id === s.catalogId && c.auth === 'account')
            ),
        )}
        catalog={catalog}
        connected={integrations}
        message={external.data?.message}
        onUseEverywhere={setConnecting}
      />

      <footer className={styles.pageFooter}>
        <ShieldCheck aria-hidden />
        <Text size="xs" tone="subtle">
          {assistant} asks before it changes anything in your apps, unless you say otherwise.
          Sign-ins and tokens stay on this computer and are never shown again.
        </Text>
      </footer>

      <ConnectDialog
        entry={connecting ?? linked}
        onOpenChange={(open) => {
          if (open) return;
          setConnecting(undefined);
          if (connectId) setParams({}, { replace: true });
        }}
        onAlternative={(id) => setConnecting(catalog.find((c) => c.id === id))}
      />
      <CustomDialog open={custom} onOpenChange={setCustom} />
    </div>
  );
}

/**
 * Servers a provider set up by itself (its own settings, plugins, its
 * account). They only work when that provider answers, so they sit apart from
 * Conch's integrations, folded away, one group per provider — each with a way
 * to bring the service into Conch when Conch can connect it itself.
 */
function ProviderServers({
  providers,
  loading,
  servers,
  catalog,
  connected,
  message,
  onUseEverywhere,
}: {
  providers: IntegrationProvider[];
  loading: boolean;
  servers: ExternalIntegration[];
  catalog: CatalogEntry[];
  connected: Integration[];
  message?: string;
  onUseEverywhere: (entry: CatalogEntry) => void;
}) {
  if (!loading && !servers.length && !message) return null;
  const groups = providers
    .map((provider) => ({
      provider,
      servers: servers.filter((s) => s.provider === provider.id),
    }))
    .filter((g) => g.servers.length > 0);
  return (
    <section aria-labelledby="int-external" className={styles.section}>
      <Stack gap={0.5}>
        <Heading level={2} id="int-external" size="sm" tone="muted">
          From your providers
        </Heading>
        <Text size="xs" tone="subtle">
          Set up inside a provider rather than in Conch, so they only work when that provider
          answers. Change them there — or bring one into Conch to use it with every model.
        </Text>
      </Stack>
      {loading ? (
        <div className={styles.externalList}>
          <Skeleton shape="text" width="60%" />
          <Skeleton shape="text" width="45%" />
        </div>
      ) : (
        <>
          {groups.map(({ provider, servers: list }) => {
            const broken = list.filter((s) => s.state === 'error' || s.state === 'needs-auth');
            return (
              <Collapsible key={provider.id} className={styles.providerGroup}>
                <Collapsible.Trigger className={styles.providerTrigger}>
                  <span className={styles.providerName}>{provider.engine}</span>
                  <Text as="span" size="xs" tone="subtle">
                    {list.length === 1 ? '1 server' : `${list.length} servers`}
                    {broken.length ? ` · ${broken.length} need attention there` : ''}
                  </Text>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <ul className={styles.externalList}>
                    {list.map((server) => {
                      const entry = catalog.find((c) => c.id === server.catalogId);
                      // Conch can connect this service itself, and hasn't yet.
                      const portable =
                        entry &&
                        entry.auth !== 'account' &&
                        !connected.some((i) => i.catalogId === entry.id)
                          ? entry
                          : undefined;
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
                              {server.state === 'ok' && server.toolCount
                                ? ` · ${server.toolCount} tools`
                                : ''}
                              {server.message ? ` · ${server.message}` : ''}
                            </Text>
                          </span>
                          {portable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onUseEverywhere(portable)}
                            >
                              Use with every model
                            </Button>
                          )}
                          <IntegrationStatusBadge state={server.state} />
                        </li>
                      );
                    })}
                  </ul>
                </Collapsible.Content>
              </Collapsible>
            );
          })}
          {message && (
            <Text size="sm" tone="muted">
              {message}
            </Text>
          )}
        </>
      )}
    </section>
  );
}

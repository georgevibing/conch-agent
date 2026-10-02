import type { CatalogEntry, Integration } from '@conch/protocol';
import {
  Button,
  Heading,
  Input,
  IntegrationCard,
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
import { categoryLabel, fixLabel, needsAttention, quietMeta } from './describe';
import styles from './Integrations.module.css';
import { useAssistantName, useIntegrations, useUpdateIntegration } from './queries';
import { SlackCard } from './SlackDetail';
import { useSlack } from './slackApi';
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
 * Integrations belong to Conch, not to a provider (ADR 0012, ADR 0049):
 * everything here works with every model you pick. What a provider set up by
 * itself and Conch can't connect lives in Settings → Providers, folded away.
 */
export function IntegrationsView() {
  useSignInResult();
  const { data, isPending } = useIntegrations();
  const assistant = useAssistantName();
  const { data: slack } = useSlack();
  const update = useUpdateIntegration();
  const { fix, pending } = useFix();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState<CatalogEntry>();
  const [custom, setCustom] = useState(false);
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');

  const integrations = useMemo(() => [...(data?.integrations ?? [])].sort(order), [data]);
  const catalog = useMemo(() => data?.catalog ?? [], [data]);
  /** Apps connected another way than an MCP server (Slack): their own card above. */
  const connectedApp = (id: string) => id === 'slack' && Boolean(slack?.connected);
  const categories = useMemo(
    () => ['all', ...new Set(catalog.map((c) => c.category))] as Category[],
    [catalog],
  );
  const needle = query.trim().toLowerCase();
  const shown = catalog
    // Ones you've connected here live in "Connected" above.
    .filter((c) => !integrations.some((i) => i.catalogId === c.id) && !connectedApp(c.id))
    .filter((c) => category === 'all' || c.category === category)
    .filter(
      (c) =>
        !needle ||
        c.name.toLowerCase().includes(needle) ||
        c.tagline.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(b.featured) - Number(a.featured));

  const openEntry = (entry: CatalogEntry) => {
    const mine = integrations.find((i) => i.catalogId === entry.id);
    if (mine) void navigate(`/integrations/${mine.id}`);
    else if (connectedApp(entry.id)) void navigate(`/integrations/${entry.id}`);
    else setConnecting(entry);
  };

  // `?connect=notion` (from ⌘K) opens that app's connect dialog straight away.
  const [params, setParams] = useSearchParams();
  const connectId = params.get('connect');
  const linked = connectId
    ? catalog.find(
        (c) =>
          c.id === connectId &&
          !integrations.some((i) => i.catalogId === c.id) &&
          !connectedApp(c.id),
      )
    : undefined;
  // `?setup=<id>` (a card's “Finish setup”): finish the one you already added.
  const unfinished = integrations.find((i) => i.id === params.get('setup'));
  const unfinishedEntry = catalog.find((c) => c.id === unfinished?.catalogId);
  // Already connected: open it instead.
  useEffect(() => {
    if (!connectId) return;
    const mine = integrations.find((i) => i.catalogId === connectId);
    if (mine) void navigate(`/integrations/${mine.id}`, { replace: true });
    else if (connectId === 'slack' && slack?.connected)
      void navigate('/integrations/slack', { replace: true });
  }, [connectId, integrations, navigate, slack?.connected]);
  const slackEntry = catalog.find((c) => c.id === 'slack');
  const anyConnected = integrations.length > 0 || Boolean(slack?.connected);

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
        anyConnected && (
          <section aria-labelledby="int-connected" className={styles.section}>
            <Heading level={2} id="int-connected" size="sm" tone="muted">
              Connected
            </Heading>
            <ul className={styles.cards}>
              {slack?.connected && slackEntry && (
                <li>
                  <SlackCard status={slack} entry={slackEntry} />
                </li>
              )}
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
            {anyConnected ? 'Add another app' : 'Connect your first app'}
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

      <footer className={styles.pageFooter}>
        <ShieldCheck aria-hidden />
        <Text size="xs" tone="subtle">
          {assistant} asks before it changes anything in your apps, unless you say otherwise.
          Sign-ins and tokens stay on this computer and are never shown again.
        </Text>
      </footer>

      <ConnectDialog
        entry={connecting ?? linked ?? unfinishedEntry}
        existingId={connecting || linked ? undefined : unfinished?.id}
        onOpenChange={(open) => {
          if (open) return;
          setConnecting(undefined);
          if (connectId || unfinished) setParams({}, { replace: true });
        }}
      />
      <CustomDialog open={custom} onOpenChange={setCustom} />
    </div>
  );
}

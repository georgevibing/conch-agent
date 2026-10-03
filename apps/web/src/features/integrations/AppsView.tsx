import {
  appSourceLine,
  madeHere,
  type CatalogEntry,
  type Channel,
  type ConchApp,
} from '@conch/protocol';
import {
  AppMadeBadge,
  Button,
  CommunityApps,
  DropOverlay,
  Heading,
  Input,
  IntegrationCard,
  Page,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  toast,
  useFileDrop,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from '../channels/api';
import { APPS as CHANNEL_APPS, channelState } from '../channels/describe';
import { errorText as channelError, putChannel, useChannels } from '../channels/queries';
import { TalkIntro } from '../channels/TalkIntro';
import conchStyles from '../conchapps/ConchApps.module.css';
import { putConchApp, useCommunityApps, useConchApps } from '../conchapps/queries';
import { updateApp } from '../conchapps/update';
import { conchAppPath } from '../conchapps/words';
import { vaultApi } from '../passwords/api';
import { useVault, vaultKeys } from '../passwords/queries';
import {
  appNeedsYou,
  describeApp,
  describeFound,
  galleryTiles,
  groupTiles,
  isFound,
  joinApps,
  TALK,
  type AppItem,
  type Tile,
} from './apps';
import { ConnectDialog } from './ConnectDialog';
import { CustomDialog, type AddStart, type AddTab } from './CustomDialog';
import { categoryLabel } from './describe';
import styles from './Integrations.module.css';
import { appPath } from './paths';
import {
  useAssistantName,
  useDismissFound,
  useIntegrations,
  useUpdateIntegration,
} from './queries';
import { useFix } from './useFix';
import { useSignInResult } from './useSignInResult';

/** What needs you first, then what's on, then the rest; by name within each. */
function order(a: AppItem, b: AppItem) {
  const rank = (i: AppItem) => (appNeedsYou(i) ? 0 : describeApp(i).enabled ? 1 : 2);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

/** The filter's words: the catalog's categories, and the apps you can talk to it from. */
const FILTER_WORDS: Record<string, string> = { ...categoryLabel, [TALK]: 'Talk to me here' };
const FILTER_ORDER = [
  'all',
  TALK,
  'productivity',
  'files',
  'passwords',
  'design',
  'business',
  'developer',
  'home',
  'browser',
  'other',
];

/**
 * `/apps`: every app, one card each (ADR 0052). What the assistant can use
 * and where you can talk to it are halves of the same app — Slack is one
 * card whether it reads for you, talks to you, or both — and "Talk to me
 * here" is a filter, where the chat apps are. Everything here belongs to
 * Conch, so it works with every model (ADR 0049).
 *
 * Three parts, top to bottom: what's connected; what Conch offers, by kind
 * (a filter or a search shows one flat list instead); and, last, what Conch
 * came across in a provider and you haven't signed in to. Those aren't
 * connected and aren't a problem: said once where they came from, one small
 * tile and one button each.
 */
export function AppsView() {
  useSignInResult();
  const { data, isPending } = useIntegrations();
  const { data: channelList, isPending: channelsPending } = useChannels();
  const { data: vault } = useVault();
  const assistant = useAssistantName();
  const update = useUpdateIntegration();
  const dismiss = useDismissFound();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { fix, pending } = useFix();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState<CatalogEntry>();
  const [params, setParams] = useSearchParams();
  // ⌘K's Make an app and Add an app from a link arrive as `?add=describe` and `?add=link`.
  const asked = params.get('add');
  const [custom, setCustom] = useState<{ tab: AddTab; start?: AddStart }>();
  const [query, setQuery] = useState('');
  // The community lives behind the search; Browse community apps asks it for everything.
  const [browsing, setBrowsing] = useState(false);
  const { data: conchApps } = useConchApps();
  const show = params.get('show') ?? 'all';
  const addYourOwn = (tab: AddTab = 'describe', start?: AddStart) => setCustom({ tab, start });
  const [seenAsk, setSeenAsk] = useState<string | null>(null);
  if (asked !== seenAsk) {
    setSeenAsk(asked);
    if (asked === 'describe' || asked === 'link') setCustom({ tab: asked });
  }
  // Asked once: the address forgets it, so a reload doesn't open it again.
  useEffect(() => {
    if (!asked) return;
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        next.delete('add');
        return next;
      },
      { replace: true },
    );
  }, [asked, setParams]);
  // A `.conchapp` dropped anywhere on Apps opens From a link with it.
  const drop = useFileDrop({
    onDrop: ({ files }) => {
      const file = files.find((f) => /\.conchapp$/i.test(f.name)) ?? files[0];
      if (file) addYourOwn('link', { link: { file } });
    },
  });

  const catalog = useMemo(() => data?.catalog ?? [], [data]);
  const items = useMemo(
    () =>
      joinApps({
        integrations: data?.integrations ?? [],
        catalog,
        channels: channelList?.channels ?? [],
        sources: vault?.status.sources ?? [],
      }).sort(order),
    [data, catalog, channelList, vault?.status.sources],
  );
  const tiles = useMemo(
    () =>
      galleryTiles({
        catalog,
        channelCatalog: channelList?.catalog ?? [],
        have: items,
        sources: vault?.status.sources ?? [],
      }),
    [catalog, channelList?.catalog, items, vault?.status.sources],
  );
  const filters = useMemo(() => {
    const present = new Set(tiles.flatMap((t) => t.categories));
    if (items.some((i) => i.talks)) present.add(TALK);
    return FILTER_ORDER.filter((f) => f === 'all' || present.has(f));
  }, [tiles, items]);

  const setShow = (value: string) =>
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        if (value === 'all') next.delete('show');
        else next.set('show', value);
        return next;
      },
      { replace: true },
    );

  const needle = query.trim().toLowerCase();
  const community = useCommunityApps(needle ? needle : browsing ? '' : undefined);
  const lookingAtCommunity = Boolean(needle) || browsing;
  const conchOf = (item: AppItem): ConchApp | undefined =>
    item.integration?.conchApp
      ? conchApps?.find((a) => a.id === item.integration?.conchApp)
      : undefined;

  /** An app's Update on its card: one press when nothing it can reach or asks for is new. */
  const updateOnCard = async (app: ConchApp) => {
    const change = app.update?.changes;
    const quiet =
      app.update?.sameSigner &&
      change &&
      !change.otherMaker &&
      !change.reachesAdded.length &&
      !change.settingsAdded.length &&
      !change.toolsNowChange.length;
    if (!quiet) return void navigate(conchAppPath(app.id));
    try {
      await guard(async () => {
        const outcome = await updateApp(app);
        // A newer version than the card said: its page shows what changed first.
        if ('look' in outcome) return void navigate(conchAppPath(app.id));
        putConchApp(client, outcome.updated);
        toast.success(
          `${outcome.updated.manifest.name} is updated to ${outcome.updated.manifest.version}`,
        );
      });
    } catch (error) {
      toast.error(channelError(error, 'It didn’t update. Nothing changed.'));
    }
  };
  const talking = show === TALK;
  const found = items.filter(isFound);
  // Looking for one by name finds it wherever it is on the page.
  const foundShown = found.filter((i) => !needle || i.name.toLowerCase().includes(needle));
  const foundWords = describeFound(found, assistant, data?.providers);
  const connected = items.filter((i) => !isFound(i));
  const mine = connected.filter((i) => !talking || i.talks);
  const shown = tiles
    .filter((t) => show === 'all' || t.categories.includes(show))
    .filter((t) => !needle || t.words.includes(needle))
    .sort(
      (a, b) =>
        Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
        Number(a.kind === 'chat') - Number(b.kind === 'chat'),
    );

  const openTile = (tile: Tile) => {
    if (tile.kind === 'chat') return void navigate(`/channels/new/${tile.id}`);
    // A password manager: its page has the switch, and says what it needs.
    if (tile.kind === 'passwords') return void navigate(appPath(tile.id));
    // 1Password is one entry point for both of its halves: its page has a switch for each.
    if (tile.id === '1password') return void navigate(appPath('1password'));
    const entry = catalog.find((c) => c.id === tile.id);
    if (entry) setConnecting(entry);
  };

  // `?connect=notion` (from ⌘K, a chat's offer) opens that app's connect dialog straight away.
  const connectId = params.get('connect');
  const linked =
    connectId && connectId !== '1password'
      ? catalog.find(
          (c) => c.id === connectId && !items.some((i) => i.integration?.catalogId === c.id),
        )
      : undefined;
  // `?setup=<id>` (a card's “Finish setup”): finish the one you already added.
  const unfinished = data?.integrations.find((i) => i.id === params.get('setup'));
  const unfinishedEntry = catalog.find((c) => c.id === unfinished?.catalogId);
  // Already connected: open it instead.
  useEffect(() => {
    if (!connectId) return;
    const have = items.find((i) => i.integration?.catalogId === connectId);
    if (have) void navigate(have.to, { replace: true });
    // 1Password's page is where both its halves are set up.
    else if (connectId === '1password') void navigate(appPath('1password'), { replace: true });
  }, [connectId, items, navigate]);

  /** The card's switch is the whole app's: every half it has goes on or off together. */
  const toggle = (item: AppItem, enabled: boolean) => {
    if (item.integration && item.integration.enabled !== enabled)
      update.mutate({ id: item.integration.id, patch: { enabled } });
    for (const channel of item.channels.filter((c) => c.enabled !== enabled))
      // Turning a way in back on is a trust decision: from elsewhere, confirm it's you.
      void guard(async () =>
        putChannel(client, await channelsApi.update(channel.id, { enabled })),
      ).catch((error: unknown) => toast.error(channelError(error)));
    if (item.source && item.source.state !== 'missing' && (item.source.state === 'off') === enabled)
      void vaultApi
        .setSource(item.source.id, { enabled })
        .then(() => client.invalidateQueries({ queryKey: vaultKeys.all }))
        .catch((error: unknown) => toast.error(channelError(error)));
  };

  /** A chat app's fix: Repair what Conch can, otherwise its page has the step. */
  const fixChannel = async (channel: Channel) => {
    const state = channelState(channel);
    if (state !== 'conflict' && state !== 'error') return void navigate(`/channels/${channel.id}`);
    try {
      const fixed = await channelsApi.repair(channel.id);
      putChannel(client, fixed);
      if (fixed.health.state === 'online')
        toast.success(`${CHANNEL_APPS[channel.kind].name} is back.`);
    } catch (error) {
      toast.error(channelError(error, 'Repair didn’t work.'));
    }
  };

  const loading = isPending || channelsPending;
  // Everything at once reads best by kind; a filter or a search is one list.
  const grouped = show === 'all' && !needle && shown.length > 0;
  const tileCard = (tile: Tile, index: number) => (
    <li key={`${tile.kind}:${tile.id}`}>
      <IntegrationCard
        variant="catalog"
        index={index}
        name={tile.name}
        brand={tile.id}
        color={tile.color}
        tagline={tile.tagline}
        local={tile.local}
        connected={false}
        onOpen={() => openTile(tile)}
      />
    </li>
  );

  return (
    <Page gap={8} {...drop.props}>
      <DropOverlay
        active={drop.dragging}
        title="Drop to add the app"
        hint="A .conchapp file someone sent you"
        className={conchStyles.dropOverlay}
      />
      <header className={styles.pageHeader}>
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Apps
          </Heading>
          <Text tone="muted">
            Connect your apps once — {assistant} can use them with every model you pick, and you can
            talk to it from the ones you chat in.
          </Text>
        </Stack>
        <Button variant="surface" leadingIcon={<Plus />} onClick={() => addYourOwn()}>
          Add your own
        </Button>
      </header>

      {loading ? (
        <div className={styles.cards}>
          <Skeleton shape="block" height="5.5rem" />
          <Skeleton shape="block" height="5.5rem" />
        </div>
      ) : (
        mine.length > 0 && (
          <section aria-labelledby="apps-connected" className={styles.section}>
            <Heading level={2} id="apps-connected" size="sm" tone="muted">
              Connected
            </Heading>
            <ul className={styles.cards}>
              {mine.map((item, index) => {
                const card = describeApp(item);
                const integration = card.fix?.integration;
                const channel = card.fix?.channel;
                const conch = conchOf(item);
                return (
                  <li key={item.key}>
                    <IntegrationCard
                      variant="connected"
                      index={index}
                      name={item.name}
                      brand={item.brand}
                      color={item.color}
                      {...(conch && {
                        app: conch.manifest.icon,
                        ...(madeHere(conch.source)
                          ? { badge: <AppMadeBadge kind="made" /> }
                          : conch.source.kind === 'github' && {
                              badge: <AppMadeBadge kind="community" />,
                            }),
                      })}
                      state={card.state}
                      message={card.message}
                      meta={
                        // Who it's from, in a few words, before its quiet facts (ADR 0061).
                        conch && !madeHere(conch.source)
                          ? [appSourceLine(conch.source, conch.signature), card.meta]
                              .filter(Boolean)
                              .join(' · ')
                          : card.meta
                      }
                      enabled={card.enabled}
                      action={
                        card.fix
                          ? {
                              label: card.fix.label,
                              onClick: () =>
                                integration
                                  ? fix(integration)
                                  : channel && void fixChannel(channel),
                              loading: Boolean(integration && pending === integration.id),
                            }
                          : undefined
                      }
                      notice={
                        conch?.update && !card.fix
                          ? {
                              message: `Version ${conch.update.version} is ready`,
                              label: 'Update',
                              onClick: () => void updateOnCard(conch),
                            }
                          : card.notice
                            ? {
                                message: card.notice.message,
                                label: card.notice.label,
                                onClick: () =>
                                  void navigate(`/channels/${card.notice?.channel.id}`),
                              }
                            : talking && !item.channels.length
                              ? {
                                  // It could talk to you too: its page has the switch.
                                  message: `You can talk to ${assistant} here too.`,
                                  label: 'Set up',
                                  onClick: () => void navigate(item.to),
                                }
                              : undefined
                      }
                      onToggle={(enabled) => toggle(item, enabled)}
                      onOpen={() => void navigate(item.to)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}

      {talking && !loading && !items.some((i) => i.channels.length) && (
        <TalkIntro assistant={assistant} />
      )}

      <section aria-labelledby="apps-gallery" className={styles.section}>
        <div className={styles.catalogHeader}>
          <Heading level={2} id="apps-gallery" size="sm" tone="muted">
            {connected.length ? 'Add another app' : 'Connect your first app'}
          </Heading>
          <div className={styles.filters}>
            {filters.length > 2 && (
              <SegmentedControl
                size="sm"
                value={filters.includes(show) ? show : 'all'}
                onValueChange={(v) => v && setShow(v)}
                aria-label="Show"
              >
                {filters.map((c) => (
                  <SegmentedControl.Item key={c} value={c}>
                    {c === 'all' ? 'All' : (FILTER_WORDS[c] ?? c)}
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
        {loading ? (
          <div className={styles.tiles}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} shape="block" height="4.25rem" />
            ))}
          </div>
        ) : grouped ? (
          <div className={styles.kinds}>
            {groupTiles(shown).map((group) => (
              <section
                key={group.id}
                aria-labelledby={`apps-kind-${group.id}`}
                className={styles.kind}
              >
                <Heading level={3} id={`apps-kind-${group.id}`} size="xs" tone="subtle">
                  {FILTER_WORDS[group.id] ?? group.id}
                </Heading>
                <ul className={styles.tiles}>{group.tiles.map(tileCard)}</ul>
              </section>
            ))}
          </div>
        ) : shown.length ? (
          <ul className={styles.tiles}>{shown.map(tileCard)}</ul>
        ) : needle ? (
          foundShown.length ? null : (
            <ul className={styles.tiles}>
              <li>
                <IntegrationCard
                  variant="catalog"
                  name={`Make “${query.trim()}” with Conch`}
                  app={{ glyph: 'sparkles', color: 'violet' }}
                  tagline="Conch builds it for you in a chat."
                  onOpen={() => addYourOwn('describe', { describe: query.trim() })}
                />
              </li>
            </ul>
          )
        ) : (
          <Stack gap={2} align="start" className={styles.noMatch}>
            <Text tone="muted">You have every app here already.</Text>
          </Stack>
        )}
        {!loading && !lookingAtCommunity && !talking && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Globe />}
              onClick={() => setBrowsing(true)}
            >
              Browse community apps
            </Button>
          </div>
        )}
      </section>

      {!loading && lookingAtCommunity && !talking && (
        <CommunityApps
          apps={community.data?.apps ?? []}
          loading={community.isFetching && !community.data}
          limited={community.data?.limited}
          offline={community.data?.offline ?? community.isError}
          query={needle || undefined}
          onLook={(app) => addYourOwn('link', { link: { link: app.url } })}
          emptyAction={
            needle ? (
              <Button
                size="sm"
                variant="surface"
                leadingIcon={<Plus />}
                onClick={() => addYourOwn('describe', { describe: query.trim() })}
              >
                Make it with Conch
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading && !talking && foundShown.length > 0 && (
        <section aria-labelledby="apps-found" className={styles.section}>
          <Stack gap={0.5}>
            <Heading level={2} id="apps-found" size="sm" tone="muted">
              {foundWords.title}
            </Heading>
            <Text size="sm" tone="subtle">
              {foundWords.lead}
            </Text>
          </Stack>
          <ul className={styles.cards}>
            {foundShown.map((item, index) => (
              <li key={item.key}>
                <IntegrationCard
                  variant="found"
                  index={index}
                  name={item.name}
                  brand={item.brand}
                  color={item.color}
                  // A try that didn't start says why, where its origin would be.
                  tagline={
                    item.integration.health.state === 'error'
                      ? item.integration.health.message
                      : foundWords.taglines[item.key]
                  }
                  action={{
                    label:
                      item.integration.health.state === 'connecting'
                        ? 'Signing in…'
                        : item.integration.health.state === 'error'
                          ? 'Try again'
                          : 'Sign in',
                    onClick: () => fix(item.integration),
                    loading: pending === item.integration.id,
                  }}
                  dismiss={{
                    label: `Don’t use ${item.name} here`,
                    onClick: () => dismiss.mutate(item.integration),
                  }}
                  onOpen={() => void navigate(item.to)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.pageFooter}>
        <ShieldCheck aria-hidden />
        <Text size="xs" tone="subtle">
          {talking
            ? `Private by default: only people you let in can talk to ${assistant}, and only in a private chat. Keys stay on this computer, and Conch connects out to each app, so nothing here is open to the internet.`
            : `${assistant} asks before it changes anything in your apps, unless you say otherwise. Sign-ins and tokens stay on this computer and are never shown again.`}
        </Text>
      </footer>

      <ConnectDialog
        entry={connecting ?? linked ?? unfinishedEntry}
        existingId={connecting || linked ? undefined : unfinished?.id}
        onOpenChange={(open) => {
          if (open) return;
          setConnecting(undefined);
          if (connectId || unfinished)
            setParams(
              (now) => {
                const next = new URLSearchParams(now);
                next.delete('connect');
                next.delete('setup');
                return next;
              },
              { replace: true },
            );
        }}
      />
      <CustomDialog
        open={Boolean(custom)}
        tab={custom?.tab}
        start={custom?.start}
        onOpenChange={(open) => !open && setCustom(undefined)}
      />
      {dialog}
    </Page>
  );
}

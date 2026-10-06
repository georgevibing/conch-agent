import {
  Button,
  EmptyState,
  Heading,
  IntegrationLogo,
  IntegrationStatusBadge,
  Page,
  Skeleton,
  Stack,
  Text,
} from '@conch/nacre';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { usePageTrail } from '../../app/trail';
import { useChannels } from '../channels/queries';
import { ConchAppDetail } from '../conchapps/ConchAppDetail';
import { useVault } from '../passwords/queries';
import { AppAbilitiesSection } from './AppAbilitiesSection';
import { describeApp, isManager, joinApps, managerItem, type AppItem } from './apps';
import { ConnectDialog } from './ConnectDialog';
import { IntegrationDetailView } from './IntegrationDetailView';
import styles from './Integrations.module.css';
import { APPS_PATH, connectPath } from './paths';
import { useIntegrations } from './queries';

/**
 * `/apps/:id`: one app's page (ADR 0052). An app the assistant uses has its
 * full page; one that's only half here — Slack you talk to but haven't let
 * it read, 1Password filling sign-ins — has the same switches, with the
 * button that sets up the other half.
 */
export function AppDetailView({ appId }: { appId: string }) {
  const { data, isPending } = useIntegrations();
  const { data: channelList, isPending: channelsPending } = useChannels();
  const { data: vault, isPending: vaultPending } = useVault();
  const navigate = useNavigate();
  // The page keeps the connect dialog, so it stays open when the half it sets up arrives.
  const [connecting, setConnecting] = useState(false);
  const [connectedId, setConnectedId] = useState<string>();

  const items = useMemo(
    () =>
      joinApps({
        integrations: data?.integrations ?? [],
        catalog: data?.catalog ?? [],
        channels: channelList?.channels ?? [],
        sources: vault?.status.sources ?? [],
      }),
    [data, channelList, vault?.status.sources],
  );
  const item =
    items.find((i) => i.integration?.id === appId) ??
    items.find((i) => i.key === appId) ??
    items.find((i) => i.integration?.catalogId === appId);
  // A live deletion can arrive before the disconnect navigation settles. Remember
  // that this page had an app, so losing it never reopens its sign-in dialog.
  if (item && connectedId !== appId) setConnectedId(appId);
  const entry = data?.catalog.find((c) => c.id === appId);
  const onePassword = vault?.status.sources.find((source) => source.id === '1password');
  // Another password manager, on or not: its page is its switch.
  const manager = vault?.status.sources.find((source) => source.id === appId && isManager(source));

  // A page for a password manager can't be told from a missing app until Passwords has answered.
  if (isPending || channelsPending || (vaultPending && !item && (appId === '1password' || !entry)))
    return (
      <Page gap={8}>
        <Skeleton shape="block" height="4.5rem" />
        <Skeleton shape="block" height="12rem" />
      </Page>
    );

  const dialogEntry = item?.entry ?? entry;
  const setUp = () => setConnecting(true);
  const withDialog = (page: ReactNode) => (
    <>
      {page}
      {dialogEntry && (
        <ConnectDialog
          entry={connecting ? dialogEntry : undefined}
          onOpenChange={(open) => !open && setConnecting(false)}
        />
      )}
    </>
  );

  // An app you made or added (ADR 0061): its own page.
  if (item?.integration?.conchApp)
    return <ConchAppDetail appId={item.integration.conchApp} item={item} />;
  if (item?.integration)
    return withDialog(
      <IntegrationDetailView integrationId={item.integration.id} item={item} onSetUp={setUp} />,
    );
  if (item) return withDialog(<HalfDetail item={item} onSetUp={setUp} />);
  // 1Password is one entry point for both its halves, even before either is on.
  if (entry?.id === '1password')
    return withDialog(
      <HalfDetail
        item={{
          key: entry.id,
          name: entry.name,
          brand: entry.id,
          ...(entry.color && { color: entry.color }),
          entry,
          channels: [],
          ...(onePassword && { source: onePassword }),
          to: '',
          talks: false,
        }}
        onSetUp={setUp}
      />,
    );
  if (manager) return withDialog(<HalfDetail item={managerItem(manager)} onSetUp={setUp} />);
  // A new visit to an unconnected app offers setup; a removed app returns to Apps.
  if (entry)
    return <Navigate to={connectedId === appId ? APPS_PATH : connectPath(entry.id)} replace />;
  return (
    <Page gap={8}>
      <EmptyState
        title="This app isn’t here any more"
        description="It may have been disconnected on another device."
        actions={<Button onClick={() => void navigate(APPS_PATH)}>See all apps</Button>}
      />
    </Page>
  );
}

/** An app with only one of its halves (or, for 1Password, none yet): its switches, and the steps. */
function HalfDetail({ item, onSetUp }: { item: AppItem; onSetUp: () => void }) {
  usePageTrail([{ label: 'Apps', to: APPS_PATH }, { label: item.name }]);
  const card = describeApp(item);
  useEffect(() => {
    document.title = `${item.name} · Conch`;
  }, [item.name]);
  const anything = item.channels.length > 0 || Boolean(item.source);
  return (
    <Page gap={8}>
      <header className={styles.detailHeader}>
        <IntegrationLogo
          brand={item.brand}
          name={item.name}
          color={item.color}
          size="xl"
          status={anything ? card.state : undefined}
          decorative
        />
        <Stack gap={1} className={styles.detailTitle}>
          <Heading level={1} size="2xl">
            {item.name}
          </Heading>
          <Stack direction="row" gap={2} align="center" wrap>
            {anything && <IntegrationStatusBadge state={card.state} />}
            {item.entry && (
              <Text as="span" size="sm" tone="muted">
                {item.entry.tagline}
              </Text>
            )}
          </Stack>
        </Stack>
      </header>
      <AppAbilitiesSection item={item} onSetUp={onSetUp} />
    </Page>
  );
}

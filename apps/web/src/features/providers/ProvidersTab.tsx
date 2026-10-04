import type { Provider } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  Heading,
  ProviderCard,
  Skeleton,
  Stack,
  Text,
} from '@conch/nacre';
import { KeyRound, Trash2, Unplug } from 'lucide-react';
import { useId, useState } from 'react';
import { useLocation } from 'react-router';

import { useAppState } from '../../api/queries';
import { ProviderServers } from '../integrations/ProviderServers';
import { settingsAt } from '../settings/paths';
import { Section } from '../settings/Section';
import { useUi } from '../../app/ui';
import { AddServer } from './AddServer';
import { ProviderDetail } from './ConnectProviderDialog';
import { FoundHere, KeyPaste } from './FoundHere';
import { ProviderGallery } from './ProviderGallery';
import styles from './Providers.module.css';
import {
  useCheckProvider,
  useClearProviderKey,
  useProviders,
  useRemoveServer,
  useUseProvider,
} from './queries';
import { brandOf, isYours, SERVER_TILE, setupLabel } from './words';

/** Quiet facts for a connected provider: who you are, and what Conch is running. */
function metaOf(provider: Provider): string {
  const { status } = provider;
  const parts = [status.auth?.description];
  if (provider.key?.source === '1password') parts.push('key in 1Password');
  if (status.version) parts.push(status.version);
  return parts.filter(Boolean).join(' · ') || 'Connected';
}

/**
 * A model on this computer that's only waiting for a model isn't "not on this
 * computer": it says what it's waiting for.
 */
function stateLabelOf(provider: Provider): string | undefined {
  if (provider.local && provider.status.state === 'not-installed' && !provider.status.fix)
    return 'Needs a model';
  return undefined;
}

/** The default first, then the others that work, then the ones that need you. */
function order(a: Provider, b: Provider) {
  const rank = (p: Provider) => (p.active ? 0 : p.status.state === 'ready' ? 1 : 2);
  return rank(a) - rank(b);
}

export function ProvidersTab() {
  const { data: app } = useAppState();
  const assistant = app?.persona.name ?? 'Conch';
  const yoursId = useId();
  // A provider's page is its own address (`/settings/providers/<id>`), so the
  // place in Settings' list, Back and a reload all work from it.
  const connecting = settingsAt(useLocation().pathname)?.item;
  const openSettings = useUi((s) => s.openSettings);
  const setConnecting = (id?: string) => openSettings('providers', id);
  const [removing, setRemoving] = useState<Provider>();
  const use = useUseProvider();
  const check = useCheckProvider();
  const clearKey = useClearProviderKey();
  const removeServer = useRemoveServer();

  const { data, isPending } = useProviders();
  const providers = data?.providers ?? [];
  const open = providers.find((provider) => provider.id === connecting);
  const pinned = Boolean(data?.pinned);

  // A provider's own address, still loading: its page is on its way, not the list.
  if (connecting && isPending) {
    return (
      <Stack gap={4} aria-busy="true">
        <Skeleton shape="block" height="4rem" />
        <Skeleton shape="block" height="9rem" />
      </Stack>
    );
  }

  // One provider opens in place of the list — never a dialog over Settings.
  if (connecting === SERVER_TILE.id && data) {
    return (
      <AddServer
        presets={data.serverPresets}
        found={data.found.filter((f) => f.kind === 'server')}
        onBack={() => setConnecting(undefined)}
        onAdded={(id) => setConnecting(id)}
        onOpen={(id) => setConnecting(id)}
      />
    );
  }
  if (open) {
    return (
      <ProviderDetail
        key={open.id}
        provider={open}
        onePassword={data?.onePassword ?? { available: false }}
        onBack={() => setConnecting(undefined)}
      />
    );
  }

  const yours = providers.filter(isYours).sort(order);
  const rest = providers.filter((p) => !isYours(p) && !p.hidden);

  return (
    <Stack gap={8}>
      <Section
        title="Providers"
        description={`Where ${assistant}’s intelligence comes from. Connect as many as you like: every one shows up in the model picker, so you can switch per chat — new chats start with your default.`}
      >
        <Stack gap={6}>
          {data?.pinned && (
            <Callout tone="info" title="Fixed for this run">
              {data.pinned}
            </Callout>
          )}
          {!pinned && !isPending && <KeyPaste providers={providers} />}

          <section aria-labelledby={yoursId} className={styles.section}>
            {!pinned && yours.length > 0 && (
              <Heading level={3} size="sm" tone="muted" id={yoursId}>
                Your providers
              </Heading>
            )}
            {isPending ? (
              <Stack gap={3}>
                <Skeleton shape="block" height="7rem" />
                <Skeleton shape="block" height="7rem" />
              </Stack>
            ) : (
              <ul className={styles.yours} aria-labelledby={yoursId}>
                {yours.map((provider, index) => {
                  const ready = provider.status.state === 'ready';
                  const busy =
                    (use.isPending && use.variables === provider.id) ||
                    (check.isPending && check.variables === provider.id);
                  return (
                    <li key={provider.id}>
                      <ProviderCard
                        index={index}
                        name={provider.name}
                        brand={brandOf(provider)}
                        color={provider.color}
                        tagline={provider.tagline}
                        state={provider.status.state}
                        stateLabel={stateLabelOf(provider)}
                        active={provider.active}
                        experimental={provider.experimental}
                        meta={metaOf(provider)}
                        message={
                          ready
                            ? undefined
                            : (provider.status.message ??
                              (provider.connect === 'key'
                                ? `Add a key and ${provider.name} is ready.`
                                : undefined))
                        }
                        highlights={provider.highlights}
                        action={
                          ready && !provider.active && !pinned
                            ? {
                                label: 'Make default',
                                onClick: () => use.mutate(provider.id),
                                loading: busy,
                              }
                            : ready
                              ? {
                                  label: 'Check again',
                                  onClick: () => check.mutate(provider.id),
                                  loading: busy,
                                }
                              : {
                                  label: setupLabel(provider),
                                  onClick: () => setConnecting(provider.id),
                                }
                        }
                        secondary={
                          ready
                            ? !provider.server && (provider.key || provider.disconnectable)
                              ? {
                                  label: provider.disconnectable ? 'Disconnect' : 'Remove key',
                                  onClick: () => setRemoving(provider),
                                }
                              : { label: 'Details', onClick: () => setConnecting(provider.id) }
                            : provider.key || provider.server
                              ? {
                                  label: provider.server ? 'Remove' : 'Remove key',
                                  onClick: () => setRemoving(provider),
                                }
                              : undefined
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {!pinned && <FoundHere found={data?.found ?? []} />}

          {!pinned && !isPending && (
            <ProviderGallery
              providers={rest}
              title={yours.length ? 'Add a provider' : 'Choose a provider'}
              onOpen={(id) => setConnecting(id)}
              onAddServer={() => setConnecting(SERVER_TILE.id)}
            />
          )}

          <Text size="xs" tone="subtle">
            Keys stay on this computer (or in 1Password) and are never shown again. Changing the
            model or provider in a chat carries the conversation over — nothing is lost.
          </Text>
        </Stack>
      </Section>

      <ProviderServers />

      <AlertDialog.Root
        open={Boolean(removing)}
        onOpenChange={(next) => !next && setRemoving(undefined)}
      >
        <AlertDialog.Content
          tone="danger"
          icon={
            removing?.server ? <Trash2 /> : removing?.disconnectable ? <Unplug /> : <KeyRound />
          }
        >
          <AlertDialog.Header>
            <AlertDialog.Title>
              {removing?.server
                ? `Remove ${removing.name}?`
                : removing?.disconnectable
                  ? `Disconnect ${removing.name}?`
                  : `Remove the ${removing?.name} key?`}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {removing?.server
                ? 'Conch forgets this server and its key. Chats that used it carry on with your default provider. You can add it again any time.'
                : removing?.disconnectable
                  ? 'Conch disconnects its own account. Your sign-ins in other apps are not changed. You can reconnect any time.'
                  : removing?.key?.source === '1password'
                    ? 'Conch forgets where to find it. The key itself stays in 1Password.'
                    : 'Conch forgets it. You can paste it again any time.'}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep it</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                tone="danger"
                loading={clearKey.isPending || removeServer.isPending}
                onClick={() => {
                  if (removing?.server) removeServer.mutate(removing.id);
                  else if (removing) clearKey.mutate(removing.id);
                  setRemoving(undefined);
                }}
              >
                {removing?.server
                  ? 'Remove'
                  : removing?.disconnectable
                    ? 'Disconnect'
                    : 'Remove key'}
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Stack>
  );
}

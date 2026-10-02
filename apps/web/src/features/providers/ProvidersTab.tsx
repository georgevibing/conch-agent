import type { Provider } from '@conch/protocol';
import { AlertDialog, Button, Callout, ProviderCard, Skeleton, Stack, Text } from '@conch/nacre';
import { useState } from 'react';

import { useAppState } from '../../api/queries';
import { ProviderServers } from '../integrations/ProviderServers';
import { Section } from '../settings/Section';
import { useUi } from '../../app/ui';
import { ProviderDetail } from './ConnectProviderDialog';
import { useCheckProvider, useClearProviderKey, useProviders, useUseProvider } from './queries';

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

/** The default first, then the others that are connected, then the rest. */
function order(a: Provider, b: Provider) {
  const rank = (p: Provider) => (p.active ? 0 : p.status.state === 'ready' ? 1 : 2);
  return rank(a) - rank(b);
}

export function ProvidersTab() {
  const { data: app } = useAppState();
  const assistant = app?.persona.name ?? 'Conch';
  // Opened to sign in to one provider (from a chat): its page, straight away.
  const [connecting, setConnecting] = useState<string | undefined>(() => {
    const focus = useUi.getState().settingsFocus;
    if (focus) useUi.setState({ settingsFocus: undefined });
    return focus;
  });
  const [removing, setRemoving] = useState<Provider>();
  const use = useUseProvider();
  const check = useCheckProvider();
  const clearKey = useClearProviderKey();

  const { data, isPending } = useProviders();
  const providers = data?.providers ?? [];
  const open = providers.find((provider) => provider.id === connecting);

  // One provider opens in place of the list — never a dialog over Settings.
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

  return (
    <Stack gap={8}>
      <Section
        title="Providers"
        description={`Where ${assistant}’s intelligence comes from. Every provider you connect shows up in the model picker, so you can switch per chat — new chats start with your default.`}
      >
        <Stack gap={3}>
          {data?.pinned && (
            <Callout tone="info" title="Fixed for this run">
              {data.pinned}
            </Callout>
          )}
          {isPending ? (
            <>
              <Skeleton shape="block" height="7rem" />
              <Skeleton shape="block" height="7rem" />
            </>
          ) : (
            [...providers].sort(order).map((provider, index) => {
              const ready = provider.status.state === 'ready';
              const busy =
                (use.isPending && use.variables === provider.id) ||
                (check.isPending && check.variables === provider.id);
              return (
                <ProviderCard
                  key={provider.id}
                  index={index}
                  name={provider.name}
                  brand={provider.status.engine}
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
                    ready && !provider.active && !data?.pinned
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
                            label: provider.local
                              ? 'Set up'
                              : provider.status.fix?.kind === 'install'
                                ? 'Install'
                                : provider.status.fix?.kind === 'update'
                                  ? 'Update'
                                  : provider.status.state === 'not-installed'
                                    ? 'How to install'
                                    : provider.status.state === 'error'
                                      ? 'Try again'
                                      : 'Connect',
                            onClick: () => setConnecting(provider.id),
                          }
                  }
                  secondary={
                    ready
                      ? provider.key || provider.disconnectable
                        ? {
                            label: provider.disconnectable ? 'Disconnect' : 'Remove key',
                            onClick: () => setRemoving(provider),
                          }
                        : { label: 'Details', onClick: () => setConnecting(provider.id) }
                      : undefined
                  }
                />
              );
            })
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
        <AlertDialog.Content tone="danger">
          <AlertDialog.Title>
            {removing?.disconnectable
              ? `Disconnect ${removing.name}?`
              : `Remove the ${removing?.name} key?`}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {removing?.disconnectable
              ? 'Conch disconnects its own account. Your sign-ins in other apps are not changed. You can reconnect any time.'
              : removing?.key?.source === '1password'
                ? 'Conch forgets where to find it. The key itself stays in 1Password.'
                : 'Conch forgets it. You can paste it again any time.'}
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep it</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                tone="danger"
                loading={clearKey.isPending}
                onClick={() => {
                  if (removing) clearKey.mutate(removing.id);
                  setRemoving(undefined);
                }}
              >
                {removing?.disconnectable ? 'Disconnect' : 'Remove key'}
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Stack>
  );
}

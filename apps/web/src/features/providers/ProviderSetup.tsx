import type { EngineId, Provider } from '@conch/protocol';
import { Button, Callout, ProviderCard, Skeleton, Stack, Text } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

import { ConnectProviderDialog } from './ConnectProviderDialog';
import styles from './Providers.module.css';
import { useCheckProvider, useProviders, useUseProvider } from './queries';

/** Ready first, then the ones you could set up, then what isn't here. */
function order(a: Provider, b: Provider) {
  const rank = (p: Provider) =>
    p.active ? 0 : p.status.state === 'ready' ? 1 : p.status.state === 'not-installed' ? 3 : 2;
  return rank(a) - rank(b);
}

export interface ProviderSetupProps {
  /** Called when there's a working provider and the flow can move on. */
  onReady?: (id: EngineId) => void;
}

/**
 * First-run provider setup: everything Conch can run on, what state each one is
 * in, and one button each. Someone who already has Claude Code signed in sees
 * that in a second and is carried onward; anyone else picks what suits them.
 */
export function ProviderSetup({ onReady }: ProviderSetupProps) {
  const { data, isPending } = useProviders();
  const [connecting, setConnecting] = useState<string>();
  const use = useUseProvider();
  const check = useCheckProvider();

  const providers = data?.providers ?? [];
  const ready = providers.find((provider) => provider.active && provider.status.state === 'ready');

  // Carry on by yourself once a provider is connected and in use — but never
  // while a setup dialog is open in front of you. The dialog closes itself when
  // it succeeds, and the flow moves on a beat later.
  const fired = useRef(false);
  useEffect(() => {
    if (!ready || !onReady || fired.current || connecting) return;
    const timer = setTimeout(() => {
      fired.current = true;
      onReady(ready.id);
    }, 1400);
    return () => clearTimeout(timer);
  }, [ready, onReady, connecting]);

  return (
    <Stack gap={4}>
      {isPending ? (
        <>
          <Skeleton shape="block" height="7rem" />
          <Skeleton shape="block" height="7rem" />
        </>
      ) : (
        [...providers].sort(order).map((provider, index) => {
          const isReady = provider.status.state === 'ready';
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
              active={provider.active}
              experimental={provider.experimental}
              meta={provider.status.auth?.description}
              message={isReady ? undefined : provider.status.message}
              highlights={provider.highlights}
              action={
                isReady
                  ? provider.active
                    ? undefined
                    : { label: 'Use this', onClick: () => use.mutate(provider.id), loading: busy }
                  : {
                      label:
                        provider.status.state === 'not-installed'
                          ? 'How to install'
                          : provider.connect === 'key'
                            ? 'Add a key'
                            : 'Sign in',
                      onClick: () => setConnecting(provider.id),
                    }
              }
            />
          );
        })
      )}

      {data?.pinned && (
        <Callout tone="info" title="Fixed for this run">
          {data.pinned}
        </Callout>
      )}

      {ready && onReady && (
        <div className={styles.waiting}>
          <Text tone="muted">You’re connected. Taking you onward…</Text>
          <span className={styles.spacer} />
          <Button variant="surface" size="sm" onClick={() => onReady(ready.id)}>
            Continue
          </Button>
        </div>
      )}

      <ConnectProviderDialog
        provider={providers.find((provider) => provider.id === connecting)}
        onePassword={data?.onePassword ?? { available: false }}
        onOpenChange={(open) => !open && setConnecting(undefined)}
      />
    </Stack>
  );
}

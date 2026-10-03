import type { EngineId, Provider } from '@conch/protocol';
import { Button, Callout, ProviderCard, Skeleton, Stack, Text } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

import { ConnectProviderDialog } from './ConnectProviderDialog';
import { FoundHere, KeyPaste } from './FoundHere';
import { ProviderGallery } from './ProviderGallery';
import styles from './Providers.module.css';
import { useCheckProvider, useProviders, useUseProvider } from './queries';
import { brandOf, isYours, setupLabel } from './words';

/** Ready first, then the ones you could finish setting up. */
function order(a: Provider, b: Provider) {
  const rank = (p: Provider) => (p.active ? 0 : p.status.state === 'ready' ? 1 : 2);
  return rank(a) - rank(b);
}

export interface ProviderSetupProps {
  /** Called when there's a working provider and the flow can move on. */
  onReady?: (id: EngineId) => void;
}

/**
 * First-run provider setup. What's already here — Claude Code signed in, a key
 * in this computer's settings, a model server running — shows first, ready in
 * a press; a key pasted anywhere is recognised; and the gallery opens on the
 * few most people pick, with every other provider one press away.
 */
export function ProviderSetup({ onReady }: ProviderSetupProps) {
  const { data, isPending } = useProviders();
  const [connecting, setConnecting] = useState<string>();
  const use = useUseProvider();
  const check = useCheckProvider();

  const providers = data?.providers ?? [];
  const ready = providers.find((provider) => provider.active && provider.status.state === 'ready');
  const yours = providers.filter(isYours).sort(order);
  const rest = providers.filter((p) => !isYours(p) && !p.hidden);

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
    <Stack gap={5}>
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
        yours.length > 0 && (
          <ul className={styles.yours} aria-label="Ready on this computer">
            {yours.map((provider, index) => {
              const isReady = provider.status.state === 'ready';
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
                    active={provider.active}
                    experimental={provider.experimental}
                    meta={provider.status.auth?.description}
                    message={isReady ? undefined : provider.status.message}
                    highlights={provider.highlights}
                    action={
                      isReady
                        ? provider.active
                          ? undefined
                          : {
                              label: 'Use this',
                              onClick: () => use.mutate(provider.id),
                              loading: busy,
                            }
                        : {
                            label: setupLabel(provider),
                            onClick: () => setConnecting(provider.id),
                          }
                    }
                  />
                </li>
              );
            })}
          </ul>
        )
      )}

      {!data?.pinned && !isPending && <KeyPaste providers={providers} />}
      {!data?.pinned && <FoundHere found={data?.found ?? []} />}
      {!data?.pinned && !isPending && rest.length > 0 && (
        <ProviderGallery
          providers={rest}
          featuredFirst
          title={yours.length ? 'Or connect another' : 'Choose what powers me'}
          onOpen={setConnecting}
        />
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

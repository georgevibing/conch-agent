import type { Provider } from '@conch/protocol';
import {
  Button,
  IconButton,
  Popover,
  ProviderLogo,
  ProviderMeter,
  Stack,
  Text,
  UsagePanel,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCw, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';
import { providerLogo } from '../models/catalog';
import { useTurnOptions } from '../models/useTurnOptions';
import { providersApi } from '../providers/api';
import { putProvider, useProviders, useUseProvider } from '../providers/queries';
import { useUsageRefresh } from '../usage/useUsageRefresh';
import styles from './ChatProvider.module.css';

/** Fresh enough to show without re-reading the provider when the panel opens. */
const FRESH_MS = 30_000;

/** What only the person can fix about a provider, in a word or two. */
function attentionOf(provider: Provider): string | undefined {
  if (provider.ready) return undefined;
  const { state } = provider.status;
  return state === 'signed-out'
    ? 'Sign in'
    : state === 'not-installed'
      ? 'Not installed'
      : 'Not ready';
}

/** Who you're signed in as, in one line: "ChatGPT Plus · you@example.com". */
function accountLine(provider: Provider): string {
  const { auth, state, message } = provider.status;
  if (state !== 'ready') return message ?? 'Not ready yet.';
  return [auth?.description ?? 'Connected', auth?.email].filter(Boolean).join(' · ');
}

/**
 * The chat's provider in the header: who answers the chat in front of you
 * and what's left of their limit, live. It follows the model chosen for the
 * chat (or for the new chat being written), so picking another provider's
 * model changes it at once. It speaks up only when that provider needs you,
 * and with nothing connected it offers to connect a provider. `/usage`, the
 * palette and the composer's limit notice open it too.
 */
export function ChatProvider({ conversationId }: { conversationId?: string }) {
  const client = useQueryClient();
  const turn = useTurnOptions(conversationId);
  const { data: list } = useProviders();
  const engine = turn.options.engine;
  const provider = list?.providers.find((p) => p.id === engine);
  const { data: usage } = useUsage(engine, Boolean(provider?.ready));
  const open = useUi((s) => s.usageOpen);
  const setOpen = useUi((s) => s.setUsageOpen);
  const openSettings = useUi((s) => s.openSettings);
  const { refresh, refreshing } = useUsageRefresh(engine);
  const makeDefault = useUseProvider();
  const [checking, setChecking] = useState(false);

  if (!list) return null;
  if (!list.providers.some((p) => p.ready))
    return <ProviderMeter onClick={() => openSettings('providers')} />;
  if (!provider) return null;

  const attention = attentionOf(provider);
  const fallback = list.providers.find((p) => p.active);
  const settings = () => {
    setOpen(false);
    openSettings('providers', provider.id);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && usage && Date.now() - usage.updatedAt > FRESH_MS) void refresh();
      }}
    >
      <Popover.Trigger asChild>
        <ProviderMeter
          provider={{ label: provider.name, logo: providerLogo(provider.id) }}
          usage={usage}
          attention={attention}
        />
      </Popover.Trigger>
      <Popover.Content
        align="end"
        aria-label={`${provider.name} for this chat`}
        padding="none"
        className={styles.content}
        // Focus the panel itself, not its first button (whose tooltip would pop up).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <div className={styles.head}>
          <ProviderLogo provider={providerLogo(provider.id)} size={18} />
          <Stack gap={0} className={styles.who}>
            <Text size="sm" weight="semibold">
              {provider.name}
            </Text>
            <Text size="xs" tone="muted" className={styles.account}>
              {accountLine(provider)}
            </Text>
          </Stack>
          <IconButton label={`${provider.name} settings`} size="sm" onClick={settings}>
            <Settings2 />
          </IconButton>
        </div>
        {attention ? (
          <Stack gap={3} className={styles.body}>
            <Text size="sm" tone="muted">
              {provider.status.state === 'signed-out'
                ? `Sign in to ${provider.name} to carry on in this chat.`
                : `${provider.name} isn’t ready on this computer yet.`}
            </Text>
            <Stack direction="row" gap={2}>
              <Button size="sm" onClick={settings}>
                {provider.status.state === 'signed-out' ? 'Sign in' : 'Finish setup'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<RotateCw />}
                loading={checking}
                onClick={async () => {
                  setChecking(true);
                  try {
                    putProvider(client, await providersApi.check(provider.id));
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                Check again
              </Button>
            </Stack>
          </Stack>
        ) : (
          usage && (
            <UsagePanel
              value={usage}
              onRefresh={() => void refresh()}
              refreshing={refreshing}
              onSetBudget={
                usage.kind === 'metered'
                  ? () => {
                      setOpen(false);
                      openSettings('usage');
                    }
                  : undefined
              }
            />
          )
        )}
        {!provider.active && fallback && provider.ready && (
          <div className={styles.foot}>
            <Text size="xs" tone="muted">
              New chats start with {fallback.name}.
            </Text>
            <Button
              size="sm"
              variant="ghost"
              loading={makeDefault.isPending}
              onClick={() => makeDefault.mutate(provider.id)}
            >
              Use {provider.name}
            </Button>
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

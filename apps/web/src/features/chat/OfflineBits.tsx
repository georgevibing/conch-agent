import {
  OfflineNotice,
  RoutedNote,
  WaitingMessage,
  formatResetAt,
  toast,
  useNow,
} from '@conch/nacre';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useAppState, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import { useProviders } from '../providers/queries';
import { FALLBACK_FOCUS } from '../settings/FallbackSection';
import styles from './Transcript.module.css';

/** The model on this computer, when it's ready to answer (ADR 0023). */
export function useLocalModel() {
  const { data } = useProviders();
  return data?.providers.find((p) => p.local && p.ready);
}

/** Is Conch online? Live: the gateway says the moment it changes. */
export function useOnline(): boolean {
  const { data: app } = useAppState();
  return app?.network.online ?? true;
}

/**
 * A message waiting for the internet. It goes by itself when Conch is back
 * online; the model on this computer can answer it now instead.
 */
export function HeldItem({
  item,
  conversationId,
}: {
  item: Extract<TranscriptItem, { kind: 'held' }>;
  conversationId?: string;
}) {
  const local = useLocalModel();
  const release = useMutation({
    mutationFn: (engine: NonNullable<typeof local>['id']) =>
      api.releaseTurn(conversationId ?? '', engine),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className={styles.aside}>
      <WaitingMessage
        state={item.sent ? 'sent' : 'waiting'}
        count={item.count}
        local={
          local && conversationId && !item.sent
            ? {
                label: local.name,
                // Until the message is on its way, not just until the gateway heard.
                busy: release.isPending || release.isSuccess,
                onAnswer: () => release.mutate(local.id),
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * Another provider answered for this chat's own — offline, or at a limit —
 * and why. At a limit, the latest line offers **Switch back** (ADR 0126):
 * the chat is its own provider's again and waits for it, and the line folds
 * to say so.
 */
export function RoutedItem({
  item,
  conversationId,
  latest = false,
}: {
  item: Extract<TranscriptItem, { kind: 'routed' }>;
  conversationId?: string | undefined;
  latest?: boolean;
}) {
  const openSettings = useUi((s) => s.openSettings);
  const now = useNow();
  const { data } = useProviders();
  const name = (id: string) => data?.providers.find((p) => p.id === id)?.name ?? 'your provider';
  const back = useMutation({
    mutationFn: () => api.limitBack(conversationId ?? '', item.from),
    onError: (error: Error) => toast.error(error.message || 'That didn’t work. Try again.'),
  });
  if (item.reason === 'limit' && item.back) {
    const until = item.back.until;
    return (
      <div className={styles.aside}>
        <RoutedNote reason="limit">
          {`Back to ${name(item.from)}: this chat waits for it${
            until !== undefined ? ` until ${formatResetAt(until, now)}` : ''
          }.`}
        </RoutedNote>
      </div>
    );
  }
  const actions =
    item.reason === 'limit'
      ? [
          ...(latest && conversationId && !back.isPending && !back.isSuccess
            ? [{ label: 'Switch back', onClick: () => back.mutate() }]
            : []),
          { label: 'Change', onClick: () => openSettings('providers', FALLBACK_FOCUS) },
        ]
      : undefined;
  return (
    <div className={styles.aside}>
      <RoutedNote reason={item.reason} {...(actions && { actions })}>
        {item.message}
      </RoutedNote>
    </div>
  );
}

/** Above the composer while offline: what will happen to what you send. */
export function ComposerOffline() {
  const online = useOnline();
  const { data: app } = useAppState();
  const local = useLocalModel();
  const update = useUpdateSettings();
  if (online) return null;
  const answers = local && (app?.preferences.offlineFallback ?? true);
  return (
    <OfflineNotice
      local={answers ? local.name : undefined}
      action={
        local && !answers
          ? {
              label: `Answer with ${local.name}`,
              onClick: () =>
                update.mutate(
                  { preferences: { offlineFallback: true } },
                  {
                    onError: (error) =>
                      toast.error(error.message || 'That didn’t save. Try again.'),
                  },
                ),
            }
          : undefined
      }
    />
  );
}

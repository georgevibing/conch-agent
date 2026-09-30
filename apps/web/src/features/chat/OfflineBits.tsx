import { OfflineNotice, RoutedNote, WaitingMessage, toast } from '@conch/nacre';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useAppState, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import { useProviders } from '../providers/queries';
import { FALLBACK_FOCUS } from '../settings/FallbackSection';
import styles from './Transcript.module.css';

/** The model on this computer, when it's ready to answer (ADR 0018). */
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
                busy: release.isPending,
                onAnswer: () => release.mutate(local.id),
              }
            : undefined
        }
      />
    </div>
  );
}

/** Another provider answered for this chat's own — offline, or at a limit — and why. */
export function RoutedItem({ item }: { item: Extract<TranscriptItem, { kind: 'routed' }> }) {
  const openSettings = useUi((s) => s.openSettings);
  return (
    <div className={styles.aside}>
      <RoutedNote
        reason={item.reason}
        action={
          item.reason === 'limit'
            ? { label: 'Change', onClick: () => openSettings('models', FALLBACK_FOCUS) }
            : undefined
        }
      >
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
              onClick: () => update.mutate({ preferences: { offlineFallback: true } }),
            }
          : undefined
      }
    />
  );
}

import { OfferCard, toast } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';
import { useAppState, useUpdateSettings } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { ConnectProviderDialog } from '../providers/ConnectProviderDialog';
import { useProviders } from '../providers/queries';
import { offersApi } from './api';

/** Connecting an image provider does not change the conversation's model. */
export function ProviderOfferItem({
  item,
  conversationId,
  className,
}: {
  item: Extract<TranscriptItem, { kind: 'offer' }>;
  conversationId?: string;
  className?: string;
}) {
  const { offer } = item;
  const { data } = useProviders();
  const { data: state } = useAppState();
  const update = useUpdateSettings();
  const provider = data?.providers.find((p) => p.id === offer.target);
  const [dialog, setDialog] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const accepted = useRef(false);
  const on = provider?.status.state === 'ready';
  const muted = state?.preferences.mutedSuggestions ?? [];
  const key = `provider:${offer.target}`;
  useEffect(() => {
    if (!waiting || !on || dialog || !conversationId || item.resolution || accepted.current) return;
    accepted.current = true;
    void offersApi.accept(conversationId, offer.offerId, {}).catch(() => {
      accepted.current = false;
      setWaiting(false);
      setError(true);
      toast.error('Couldn’t carry on. Press Carry on to try again.');
    });
  }, [waiting, on, dialog, conversationId, item.resolution, offer.offerId]);
  if (item.resolution === 'dismissed' || muted.includes(key)) return null;
  return (
    <>
      <OfferCard
        className={className}
        kind="app"
        name={offer.name}
        brand={offer.target}
        description={offer.description}
        why={offer.why}
        state={
          item.resolution === 'accepted'
            ? 'accepted'
            : item.resolution === 'expired'
              ? 'expired'
              : on
                ? 'ready'
                : 'suggested'
        }
        busy={busy || (waiting && !error)}
        onTake={() => {
          setError(false);
          setWaiting(true);
          setDialog(true);
        }}
        onCarryOn={() => {
          setError(false);
          setWaiting(true);
        }}
        onNotNow={() => {
          if (!conversationId) return;
          setBusy(true);
          void offersApi
            .dismiss(conversationId, offer.offerId)
            .catch(() => toast.error('Couldn’t dismiss this offer.'))
            .finally(() => setBusy(false));
        }}
        onMute={() => {
          update.mutate(
            { preferences: { mutedSuggestions: [...new Set([...muted, key])] } },
            {
              onSuccess: () =>
                toast(`${offer.name} won’t be suggested again.`, {
                  action: {
                    label: 'Undo',
                    onClick: () => update.mutate({ preferences: { mutedSuggestions: muted } }),
                  },
                }),
            },
          );
        }}
      />
      <ConnectProviderDialog
        provider={dialog && !item.resolution ? provider : undefined}
        onePassword={data?.onePassword ?? { available: false }}
        onOpenChange={(open) => {
          setDialog(open);
          if (!open && !on) setWaiting(false);
        }}
      />
    </>
  );
}

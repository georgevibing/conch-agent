import { AppOffer, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { conchAppsApi } from './api';
import { putConchApp, useConchApp } from './queries';
import { ShareFlow } from './ShareFlow';
import { appWords, conchAppPath } from './words';

type OfferEntry = Extract<TranscriptItem, { kind: 'conch-app-offer' }>;
type ShareEntry = Extract<TranscriptItem, { kind: 'conch-app-share' }>;

/**
 * An app the assistant made or found, under its reply (ADR 0061): **Add to
 * my apps** with what the person types into the card, **Open the page** to
 * try a draft's page beside the chat first, **Not now**. Added, its examples
 * are one tap from being said in this chat. What the card shows is the
 * newest word in the chat's log for its offer, so a reload or another
 * device draws it the same.
 */
export function AppOfferItem({
  item,
  conversationId,
  onSend,
  className,
}: {
  item: OfferEntry;
  conversationId?: string;
  /** Say one of its examples in this chat, as the message box would. */
  onSend?: (text: string) => void;
  className?: string;
}) {
  const { offer } = item;
  const client = useQueryClient();
  const navigate = useNavigate();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const openAppPage = useUi((s) => s.openAppPage);
  const [busy, setBusy] = useState(false);
  // An update keeps the settings the app already has: the card asks only for new ones.
  const { data: installed } = useConchApp(
    offer.action === 'update' ? offer.manifest.id : undefined,
  );

  const add = async (settings: Record<string, string>) => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await guard(async () => {
        const app = await conchAppsApi.acceptOffer(offer.offerId, { conversationId, settings });
        putConchApp(client, app);
      });
    } catch (error) {
      toast.error(errorText(error, `${offer.manifest.name} wasn’t added. Try again.`));
    } finally {
      setBusy(false);
    }
  };

  const notNow = async () => {
    if (!conversationId) return;
    try {
      await conchAppsApi.declineOffer(offer.offerId, conversationId);
    } catch (error) {
      toast.error(errorText(error, 'That didn’t work. Try again.'));
    }
  };

  const done = offer.state === 'added' || offer.state === 'updated';
  const draftPage = offer.from === 'draft' && offer.draftId ? offer.draftId : undefined;
  return (
    <>
      <AppOffer
        className={className}
        action={offer.action}
        manifest={offer.manifest}
        tools={offer.tools}
        source={offer.source}
        signature={offer.signature}
        {...(offer.changes && { changes: offer.changes })}
        {...(offer.summary && { summary: offer.summary })}
        state={offer.state}
        {...(offer.message && { message: offer.message })}
        words={appWords(offer)}
        saved={offer.changes?.otherMaker ? [] : (installed?.saved ?? [])}
        busy={busy}
        onAdd={conversationId ? (settings) => void add(settings) : undefined}
        onNotNow={conversationId ? () => void notNow() : undefined}
        onOpenPage={
          conversationId && draftPage
            ? (pageId) => openAppPage({ conversationId, owner: { draftId: draftPage }, pageId })
            : undefined
        }
        onTry={done ? onSend : undefined}
        onOpenApp={done ? () => void navigate(conchAppPath(offer.manifest.id)) : undefined}
      />
      {dialog}
    </>
  );
}

/** "Put it on GitHub": the same share steps as the app's page, pressed by the person. */
export function AppShareItem({ item, className }: { item: ShareEntry; className?: string }) {
  const { data: app } = useConchApp(item.share.appId);
  return (
    <ShareFlow
      className={className}
      appId={item.share.appId}
      name={app?.manifest.name ?? item.share.name}
      source={app?.source}
    />
  );
}

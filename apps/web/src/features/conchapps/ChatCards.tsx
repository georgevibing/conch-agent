import { AppOffer, toast, type PartTestView, type PartValues } from '@conch/nacre';
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
import { bringsOf, testView } from './parts';
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
  /** Pressed here: shown at once, until the chat's log says how it went. */
  const [sent, setSent] = useState<'added' | 'declined'>();
  // An update keeps the settings the app already has: the card asks only for new ones.
  const { data: installed } = useConchApp(
    offer.action === 'update' ? offer.manifest.id : undefined,
  );

  const brings = bringsOf(offer.manifest);
  const add = async (settings: Record<string, string>, part?: PartValues) => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await guard(async () => {
        const app = await conchAppsApi.acceptOffer(offer.offerId, {
          conversationId,
          settings,
          ...(part && { parts: { ...(part.key && { key: part.key }), fields: part.fields } }),
        });
        putConchApp(client, app);
        // In, but its provider or chat app didn't take what was typed: said, with where to fix it.
        if (app.partProblem) toast.error(app.partProblem);
        void client.invalidateQueries({ queryKey: ['providers'] });
        void client.invalidateQueries({ queryKey: ['capabilities'] });
        void client.invalidateQueries({ queryKey: ['channels'] });
        // Added: the card says so now, not when the log's word arrives.
        setSent('added');
      });
    } catch (error) {
      toast.error(errorText(error, `${offer.manifest.name} wasn’t added. Try again.`));
    } finally {
      setBusy(false);
    }
  };

  const notNow = async () => {
    if (!conversationId) return;
    setSent('declined');
    try {
      await conchAppsApi.declineOffer(offer.offerId, conversationId);
    } catch (error) {
      setSent(undefined);
      toast.error(errorText(error, 'That didn’t work. Try again.'));
    }
  };

  const state =
    offer.state === 'ready' && sent
      ? sent === 'added' && offer.action === 'update'
        ? 'updated'
        : sent
      : offer.state;
  const done = state === 'added' || state === 'updated';
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
        state={state}
        {...(offer.message && { message: offer.message })}
        {...(((done && installed?.picture) || offer.picture) && {
          picture: (done && installed?.picture) || offer.picture,
        })}
        words={appWords(offer)}
        saved={offer.changes?.otherMaker ? [] : (installed?.saved ?? [])}
        busy={busy}
        onAdd={conversationId ? (settings, part) => void add(settings, part) : undefined}
        {...(brings && { brings })}
        {...(brings &&
          conversationId && {
            onTest: async (values: PartValues) => {
              let result: PartTestView = { state: 'failed', message: 'The test didn’t run.' };
              await guard(async () => {
                result = testView(
                  await conchAppsApi.testOffer(offer.offerId, {
                    conversationId,
                    ...(values.key && { key: values.key }),
                    fields: values.fields,
                  }),
                );
              }).catch((error: unknown) => {
                result = { state: 'failed', message: errorText(error, 'The test didn’t run.') };
              });
              return result;
            },
          })}
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

import { MUTED_MARKET, type AcceptOfferBody, type CatalogEntry } from '@conch/protocol';
import { OfferAlsoTry, OfferCard, type OfferCardState, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { api } from '../../api/client';
import { useConchApps } from '../conchapps/queries';
import { integrationsApi } from '../integrations/api';
import { useAppState, useUpdateSettings } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { ConnectDialog } from '../integrations/ConnectDialog';
import {
  errorText,
  putIntegration,
  useAssistantName,
  useIntegrations,
} from '../integrations/queries';
import { signInResults } from '../integrations/useSignInResult';
import { MarketOfferDialog } from '../skills/Discover';
import { skillKeys, useSkills } from '../skills/queries';
import { offersApi } from './api';

type OfferEntry = Extract<TranscriptItem, { kind: 'offer' }>;

/** How a muted offer is written in `mutedSuggestions`: apps by id, skills as `skill:<id>`. */
export const mutedKey = (offer: OfferEntry['offer']) =>
  offer.kind === 'skill'
    ? `skill:${offer.target}`
    : offer.kind === 'market'
      ? MUTED_MARKET
      : offer.target;

/**
 * An offer to turn on what a request is missing (ADR 0060), under the reply
 * that needed it. **Connect** opens the connect dialog right here, and once
 * the app is connected the chat carries on by itself; a skill shows what it
 * may do, then turns on (or is used once) and carries on the same way. On a
 * phone, signing in leaves the page and comes back to this chat with the
 * offer, which is then taken by itself.
 */
export function OfferItem({
  item,
  conversationId,
  className,
  onAskAgain,
  focusComposer,
}: {
  item: OfferEntry;
  conversationId?: string;
  className?: string;
  /** For an offer from an older log: send the question again, once connected. */
  onAskAgain?: () => void;
  /** Give the message box focus back (the card it was in went away). */
  focusComposer?: () => void;
}) {
  const { offer } = item;
  const { data } = useIntegrations();
  const { data: app } = useAppState();
  const { data: skills } = useSkills();
  const update = useUpdateSettings();
  const assistant = useAssistantName();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<CatalogEntry>();
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  /** Muted or unmuted from this card; otherwise the setting decides. */
  const [mutedHere, setMutedHere] = useState<boolean>();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Taken here: drawn taken at once, until the gateway's word (or a failure) says otherwise. */
  const [taking, setTaking] = useState(false);
  /**
   * Connect was pressed here, or signing in came back here: once it's
   * connected, this device takes the offer. Anywhere else it waits for a press.
   */
  const [waiting, setWaiting] = useState(() => params.get('offer') === offer.offerId);
  const accepting = useRef(false);

  const isApp = offer.kind === 'app';
  // A skill people share (ADR 0074): read in a dialog, added, then the chat carries on.
  const isMarket = offer.kind === 'market';
  const [reading, setReading] = useState(false);
  // A Conch app you have but switched off (ADR 0061): its card is `capp_<id>`, and the fix is its switch.
  const conchApp = isApp && offer.target.startsWith('capp_');
  const { data: conchApps } = useConchApps();
  const made = conchApp ? conchApps?.find((a) => a.integrationId === offer.target) : undefined;
  const entry = isApp && !conchApp ? data?.catalog.find((c) => c.id === offer.target) : undefined;
  const integration = isApp
    ? data?.integrations.find((i) => (i.catalogId ?? i.id) === offer.target)
    : undefined;
  const skill = isApp
    ? undefined
    : isMarket
      ? skills?.skills.find((s) => s.origin?.listingId === offer.target)
      : skills?.skills.find((s) => s.id === offer.target);
  const manual = offer.skillMode === 'manual';
  const on = isApp
    ? integration?.health.state === 'ok' || integration?.health.state === 'warning'
    : isMarket
      ? Boolean(skill && !skill.problem && skill.mode !== 'off')
      : Boolean(skill && !skill.problem && (manual ? skill.mode === 'auto' : skill.mode !== 'off'));
  const open = !item.resolution;
  const muted = app?.preferences.mutedSuggestions ?? [];
  const isMuted = mutedHere ?? muted.includes(mutedKey(offer));

  /** Take it: the gateway checks it's on and carries on, once. Resolves whether that worked. */
  const take = async (how?: AcceptOfferBody['skill']): Promise<boolean> => {
    if (!conversationId || accepting.current) return false;
    accepting.current = true;
    try {
      await offersApi.accept(conversationId, offer.offerId, how ? { skill: how } : {});
    } catch (error) {
      accepting.current = false;
      toast.error(errorText(error, 'Couldn’t carry on.'));
      return false;
    }
    if (!isApp) void client.invalidateQueries({ queryKey: skillKeys.all });
    // The button that had focus folded away with the card.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) focusComposer?.();
    });
    return true;
  };
  const accept = (how?: AcceptOfferBody['skill']) => {
    setTaking(true);
    void take(how).then((took) => {
      if (!took) setTaking(false);
    });
  };

  // Connected (here, in the dialog, or in the sign-in page this tab came back from): carry on.
  const carryOn = useEffectEvent(() => void take());
  const ready = waiting && open && on && isApp && !item.legacy;
  useEffect(() => {
    if (ready) carryOn();
  }, [ready]);

  // Back from signing in on a phone: say how it went if it didn't, and tidy the address.
  useEffect(() => {
    if (params.get('offer') !== offer.offerId) return;
    const result = params.get('result');
    const said = result && result !== 'connected' ? signInResults[result] : undefined;
    if (said?.tone === 'error') toast.error(said.text);
    else if (said) toast(said.text);
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        next.delete('offer');
        next.delete('result');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams, offer.offerId]);

  // Until the apps are here there's nothing to connect with: wait, rather than flicker.
  if (isApp && !data) return null;
  if (gone || (item.resolution === 'dismissed' && !leaving)) return null;
  if (open && isMuted && mutedHere === undefined) return null;
  // An older offer, connected since, with nothing to ask again: nothing left to say.
  if (item.legacy && on && !onAskAgain && !item.resolution) return null;

  const connecting =
    isApp && integration && ['connecting', 'checking'].includes(integration.health.state);
  const state: OfferCardState = leaving
    ? 'dismissed'
    : item.resolution === 'accepted' || (taking && open)
      ? 'accepted'
      : item.resolution === 'expired'
        ? 'expired'
        : isMuted
          ? 'muted'
          : on
            ? 'ready'
            : connecting
              ? 'connecting'
              : reviewing
                ? 'review'
                : 'suggested';

  /** **Turn on**: the same switch as its card in Apps; once it works, the chat carries on. */
  const turnOn = async () => {
    if (!integration) return;
    setBusy(true);
    try {
      const turned = await integrationsApi.update(integration.id, { enabled: true });
      putIntegration(client, turned);
      if (turned.health.state === 'ok' || turned.health.state === 'warning') {
        setWaiting(true);
        return;
      }
      // It needs something only the person has (a key): its page has the field.
      toast(turned.health.message ?? `${turned.name} needs something from you first.`, {
        action: {
          label: `Open ${turned.name}`,
          onClick: () =>
            window.dispatchEvent(
              new CustomEvent('conch:navigate', { detail: `/apps/${turned.id}` }),
            ),
        },
      });
    } catch (error) {
      toast.error(errorText(error, `${offer.name} didn’t turn on. Try again.`));
    } finally {
      setBusy(false);
    }
  };

  const mute = (yes: boolean) => {
    setMutedHere(yes);
    const key = mutedKey(offer);
    const next = yes ? [...new Set([...muted, key])] : muted.filter((id) => id !== key);
    update.mutate({ preferences: { mutedSuggestions: next } });
  };

  const permissions = skill?.permissions;
  return (
    <>
      <OfferCard
        className={className}
        kind={offer.kind}
        name={offer.name}
        brand={
          isApp
            ? offer.target
            : (skill?.name ?? (isMarket ? offer.target.split('/').pop() : offer.target))
        }
        {...(isMarket &&
          offer.market && {
            market: offer.market,
            muteLabel: 'Don’t suggest skills from Discover',
          })}
        color={offer.color}
        description={offer.description}
        why={offer.why}
        skillMode={offer.skillMode}
        assistant={assistant}
        state={state}
        busy={busy || (state === 'ready' && waiting && !item.legacy)}
        taken={!isApp && manual && skill?.mode !== 'auto' ? 'once' : 'on'}
        {...(permissions && {
          permissions: {
            capabilities: permissions.capabilities,
            words: permissions.words,
            declared: permissions.declared,
          },
        })}
        {...(made && { app: made.manifest.icon })}
        onTake={
          conchApp
            ? () => void turnOn()
            : isApp
              ? entry &&
                (() => {
                  setWaiting(true);
                  setDialog(entry);
                })
              : isMarket
                ? () => setReading(true)
                : () => setReviewing(true)
        }
        onTurnOn={() => accept('on')}
        onUseOnce={() => accept('once')}
        onCarryOn={item.legacy ? onAskAgain : () => accept()}
        onNotNow={() => {
          setLeaving(true);
          if (!conversationId) return;
          void (
            item.legacy
              ? api.dismissSuggestion(conversationId, offer.target)
              : offersApi.dismiss(conversationId, offer.offerId)
          ).catch(() => undefined);
        }}
        onMute={() => mute(true)}
        onUnmute={() => mute(false)}
        onGone={() => {
          setGone(true);
          focusComposer?.();
        }}
      />
      {isMarket && (
        <MarketOfferDialog
          listingId={offer.target}
          open={reading && !item.resolution}
          onOpenChange={setReading}
          onAdded={(added) => {
            setReading(false);
            toast.success(`Added ${added.title}`);
            accept();
          }}
        />
      )}
      {isApp && !conchApp && (
        <ConnectDialog
          // Taken: the dialog has done its job.
          entry={item.resolution ? undefined : dialog}
          existingId={
            dialog && dialog.id === (integration?.catalogId ?? integration?.id)
              ? integration?.id
              : undefined
          }
          onOpenChange={(next) => {
            if (next) return;
            setDialog(undefined);
            // Walked away before it connected: it no longer carries on by itself.
            if (!on && !connecting) setWaiting(false);
          }}
          inChat
          {...(conversationId &&
            !item.legacy && { back: { conversationId, offerId: offer.offerId } })}
          {...(item.legacy && onAskAgain && { onAskAgain })}
        />
      )}
    </>
  );
}

/**
 * “Also try”, under the reply that carried on once an app was connected: its
 * catalog examples, each sent as it reads.
 */
export function OfferAlsoTryItem({
  target,
  onSend,
  className,
}: {
  target: string;
  onSend: (text: string) => void;
  className?: string;
}) {
  const { data } = useIntegrations();
  const examples = data?.catalog.find((c) => c.id === target)?.examples ?? [];
  return <OfferAlsoTry className={className} examples={examples} onPick={onSend} />;
}

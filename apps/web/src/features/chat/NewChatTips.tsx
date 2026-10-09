import { NEW_CHAT_TIPS, type NewChatTip } from '@conch/protocol';
import { Button, IconButton, Tooltip, toast } from '@conch/nacre';
import { ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState, useUpdateSettings } from '../../api/queries';
import { useStable } from '../../lib/useStable';
import { useChannels } from '../channels/queries';
import { useComeHomeTip, usePastChatsTip } from '../import/BringHints';
import { useIntegrations } from '../integrations/queries';
import styles from './NewChatTips.module.css';

/**
 * The tips under the box on a new chat: what Conch can do for you next, now
 * that the welcome doesn't stop for it (ADR 0068, amended). Each lasts only
 * while there's something to do, and has a × that puts it away for good, on
 * every device (`preferences.tipsPutAway`); Settings → General shows them
 * again.
 *
 * One at a time, like everything that asks for attention in the chat
 * (working agreement 14), in the order of `NEW_CHAT_TIPS`:
 *
 * 1. **Connect apps** first: it's what lets the assistant reach anything, in
 *    every chat from now on.
 * 2. **Another assistant's things**: its memories and agents change every
 *    answer that follows.
 * 3. **Past chats**: history, worth having, but nothing waits on it.
 * 4. **Chat apps** last: a way in from the phone, once the rest is in place.
 *
 * Put one away and the row stays quiet for this new chat; the next tip waits
 * for the next one, so a × never looks like it summoned another ask.
 */

export interface Tip {
  id: NewChatTip;
  /** Short enough for a phone's width. */
  label: string;
  /** Said in full (the name read aloud, and the tooltip) when the line leaves something out. */
  full?: string;
  open: () => void;
}

/** A tip to show, `null` for nothing to offer, `undefined` while that's still being found out. */
export type TipFound = Tip | null | undefined;

/**
 * The first tip in order that isn't put away. A tip that's still being found
 * out holds the ones after it back, so a later one never shows and is then
 * replaced.
 */
export function pickTip(
  found: Readonly<Record<NewChatTip, TipFound>>,
  putAway: ReadonlySet<NewChatTip>,
): TipFound {
  for (const id of NEW_CHAT_TIPS) {
    if (putAway.has(id)) continue;
    const tip = found[id];
    if (tip !== null) return tip;
  }
  return null;
}

/** Until something is connected, point at where the assistant gets its reach. */
function useConnectAppsTip(): TipFound {
  const { data, isError } = useIntegrations();
  const navigate = useNavigate();
  if (isError) return null;
  if (!data) return undefined;
  if (data.integrations.length > 0) return null;
  return {
    id: 'connect-apps',
    label: 'Connect Gmail, GitHub and more',
    open: () => void navigate('/apps'),
  };
}

/** Until a chat app is connected, point at talking to the assistant from your phone. */
function useChatAppsTip(): TipFound {
  const { data, isError } = useChannels();
  const navigate = useNavigate();
  if (isError) return null;
  if (!data) return undefined;
  if (data.channels.length > 0) return null;
  return {
    id: 'chat-apps',
    label: 'Talk to it from your chat apps',
    open: () => void navigate('/apps?show=talk'),
  };
}

const NOTHING_PUT_AWAY: readonly NewChatTip[] = [];

export function NewChatTips() {
  const { data: app } = useAppState();
  const save = useUpdateSettings();
  const list = app?.preferences.tipsPutAway ?? NOTHING_PUT_AWAY;
  const putAway = new Set(list);
  // A tip put away isn't looked for: finding past chats reads the disk.
  const wanted = (id: NewChatTip) => !!app && !putAway.has(id);
  const found: Record<NewChatTip, TipFound> = {
    'connect-apps': useConnectAppsTip(),
    'come-home': useComeHomeTip(wanted('come-home')),
    'past-chats': usePastChatsTip(wanted('past-chats')),
    'chat-apps': useChatAppsTip(),
  };
  const [quiet, setQuiet] = useState(false);

  const bringBack = useStable((id: NewChatTip) => {
    save.mutate({ preferences: { tipsPutAway: list.filter((other) => other !== id) } });
    setQuiet(false);
  });
  const putTipAway = (tip: Tip) => {
    setQuiet(true);
    save.mutate({ preferences: { tipsPutAway: [...list, tip.id] } });
    toast('That tip won’t show again', {
      description: 'Settings → General shows tips again.',
      action: { label: 'Undo', onClick: () => bringBack(tip.id) },
    });
  };

  if (!app || quiet) return null;
  const tip = pickTip(found, putAway);
  if (!tip) return null;
  const go = (
    <Button
      variant="ghost"
      size="sm"
      trailingIcon={<ArrowRight />}
      onClick={tip.open}
      aria-label={tip.full}
      className={styles.tip}
    >
      {tip.label}
    </Button>
  );
  return (
    <div className={styles.row}>
      {tip.full ? <Tooltip content={tip.full}>{go}</Tooltip> : go}
      <IconButton
        variant="ghost"
        size="sm"
        label="Don’t show this tip again"
        onClick={() => putTipAway(tip)}
        className={styles.away}
      >
        <X />
      </IconButton>
    </div>
  );
}

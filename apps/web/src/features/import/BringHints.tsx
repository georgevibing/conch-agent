import { useUi } from '../../app/ui';
import type { Tip, TipFound } from '../chat/NewChatTips';
import { comeHomeItem } from '../settings/paths';
import { useImportStatus } from './api';
import { PAST_CHATS_FOCUS, useChatImportStatus } from './pastChats';

/**
 * What the welcome used to ask about (ADR 0068, amended), offered on the new
 * chat instead, as tips beside "Connect Gmail, GitHub and more": another
 * assistant's things (ADR 0035) and past chats from other apps (ADR 0111).
 * Each is one short line, only while there's something to bring, gone once
 * it's in; it opens the place in Settings → What Conch knows where nothing moves until
 * the person says so. Where the things come from is said in full in its name
 * and tooltip, so the line itself fits a phone.
 */

const nf = new Intl.NumberFormat('en');

/** “OpenClaw”, “OpenClaw and Hermes”. */
const listed = (words: readonly string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** Another assistant on this computer whose things haven't come over yet. */
export function useComeHomeTip(enabled = true): TipFound {
  const { data, isError } = useImportStatus(enabled);
  const openSettings = useUi((s) => s.openSettings);
  if (!enabled || isError) return null;
  if (!data) return undefined;
  const waiting = data.sources.filter((s) => !s.imported);
  const first = waiting[0];
  if (!first) return null;
  const from = listed(waiting.map((s) => s.label));
  const tip: Tip = {
    id: 'come-home',
    // One assistant fits by name; more are counted, and named in full below.
    label:
      waiting.length === 1
        ? `Bring your things from ${first.label}`
        : `Bring your things from ${waiting.length} assistants`,
    open: () => openSettings('memory', comeHomeItem(first.id)),
  };
  return waiting.length === 1 ? tip : { ...tip, full: `Bring your things from ${from}` };
}

/** Conversations in other apps here, until the person has brought some in. */
export function usePastChatsTip(enabled = true): TipFound {
  const { data, isError } = useChatImportStatus(enabled);
  const openSettings = useUi((s) => s.openSettings);
  if (!enabled || isError) return null;
  if (!data) return undefined;
  // Once they've said yes, new ones come in by themselves: nothing more to offer.
  if (data.brought > 0 || data.running) return null;
  const fresh = data.sources.filter((s) => s.fresh > 0);
  const count = fresh.reduce((n, s) => n + s.fresh, 0);
  if (!count) return null;
  const label = `Bring in ${nf.format(count)} past ${count === 1 ? 'chat' : 'chats'}`;
  return {
    id: 'past-chats',
    label,
    full: `${label} from ${listed(fresh.map((s) => s.label))}`,
    open: () => openSettings('memory', PAST_CHATS_FOCUS),
  };
}

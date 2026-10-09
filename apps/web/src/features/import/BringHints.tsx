import { Button } from '@conch/nacre';
import { ArrowRight } from 'lucide-react';

import { useUi } from '../../app/ui';
import { comeHomeItem } from '../settings/paths';
import { useImportStatus } from './api';
import { PAST_CHATS_FOCUS, useChatImportStatus } from './pastChats';

/**
 * What the welcome used to ask about (ADR 0068, amended), offered on the new
 * chat instead, beside "Connect Gmail, Notion, GitHub and more": another
 * assistant's things (ADR 0035) and past chats from other apps (ADR 0111).
 * Each is one quiet line, only while there's something to bring, gone once
 * it's in; it opens the place in Settings → Memory where nothing moves until
 * the person says so.
 */

const nf = new Intl.NumberFormat('en');

/** “OpenClaw”, “OpenClaw and Hermes”. */
const listed = (words: readonly string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** Another assistant on this computer whose things haven't come over yet. */
export function ComeHomeHint({ className }: { className?: string }) {
  const { data } = useImportStatus();
  const openSettings = useUi((s) => s.openSettings);
  const waiting = data?.sources.filter((s) => !s.imported) ?? [];
  const first = waiting[0];
  if (!first) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      trailingIcon={<ArrowRight />}
      onClick={() => openSettings('memory', comeHomeItem(first.id))}
      className={className}
    >
      Bring your things from {listed(waiting.map((s) => s.label))}
    </Button>
  );
}

/** Conversations in other apps here, until the person has brought some in. */
export function PastChatsHint({ className }: { className?: string }) {
  const { data } = useChatImportStatus();
  const openSettings = useUi((s) => s.openSettings);
  // Once they've said yes, new ones come in by themselves: nothing more to offer.
  if (!data || data.brought > 0 || data.running) return null;
  const fresh = data.sources.filter((s) => s.fresh > 0);
  const count = fresh.reduce((n, s) => n + s.fresh, 0);
  if (!count) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      trailingIcon={<ArrowRight />}
      onClick={() => openSettings('memory', PAST_CHATS_FOCUS)}
      className={className}
    >
      Bring in {nf.format(count)} past {count === 1 ? 'chat' : 'chats'} from{' '}
      {listed(fresh.map((s) => s.label))}
    </Button>
  );
}

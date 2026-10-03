import { ReplyChips } from '@conch/nacre';

import type { ConversationView } from '../../live/reducer';
import styles from './NextReplies.module.css';

/** Tolerance for the gateway's clock running a little behind this device's. */
const CLOCK_SLACK_MS = 1500;

/**
 * Replies to send next (ADR 0055), under the latest reply while the chat is
 * idle. A tap sends the words as the message box would, and they go as soon
 * as anything newer is in the chat: a message from any device, a new turn.
 */
export function NextReplies({
  view,
  waiting,
  openedAt,
  onSend,
}: {
  view: ConversationView;
  /** A message of yours is on its way: the chips have done their job. */
  waiting: boolean;
  /** When the chat was opened here: chips that came before it don't rise in again. */
  openedAt: number;
  onSend: (text: string) => void;
}) {
  const latest = view.replies;
  if (!latest || waiting || view.status !== 'idle') return null;
  return (
    <ReplyChips
      // A new set is new chips: nothing pressed carries over.
      key={latest.seq}
      replies={latest.replies}
      onSend={onSend}
      entrance={latest.at >= openedAt - CLOCK_SLACK_MS}
      className={styles.replies}
      data-by={latest.by}
    />
  );
}

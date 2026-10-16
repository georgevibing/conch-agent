import { CircleStop, Inbox, MoreHorizontal, Send } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { DropdownMenu } from '../../components/DropdownMenu';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './Together.module.css';

/** Where a message between two of your chats is. */
export type ChatMessageState = 'waiting' | 'read' | 'held' | 'refused' | 'dismissed';
/** Whether a chat takes messages from your other chats. */
export type ChatInboundChoice = 'accept' | 'hold' | 'refuse';

export interface ChatMessageCardProps extends Omit<ComponentProps<'article'>, 'children'> {
  /** `out`: this chat sent it; `in`: it came here. */
  direction: 'out' | 'in';
  /** `stop`: the sender stopped this chat's reply, and says why. */
  kind?: 'message' | 'stop';
  /** The other chat: where it went, or where it's from. */
  chatTitle: string;
  text: string;
  state: ChatMessageState;
  /** It starts a reply there when it arrives. */
  wakes?: boolean;
  /** Why it was turned away, when it was. */
  why?: string;
  /** Open the other chat. */
  onOpenChat?: () => void;
  /** A held message: let it through, or not. */
  onPass?: () => void;
  onDismiss?: () => void;
  /** This chat's own setting for messages from your other chats, on a card that came here. */
  inbound?: ChatInboundChoice;
  onInboundChange?: (choice: ChatInboundChoice) => void;
}

const INBOUND: { value: ChatInboundChoice; label: string }[] = [
  { value: 'accept', label: 'Let them in' },
  { value: 'hold', label: 'Hold them for me' },
  { value: 'refuse', label: 'Turn them away' },
];

/** What a card's state says, in a word or two, for each side. */
export function chatMessageStateWords(
  state: ChatMessageState,
  direction: 'out' | 'in',
  wakes = false,
): string {
  switch (state) {
    case 'waiting':
      return wakes ? (direction === 'out' ? 'Starts its next reply' : 'Starts the next reply') : 'Not read yet';
    case 'read':
      return 'Read';
    case 'held':
      return direction === 'out' ? 'Held for the person' : 'Held for you';
    case 'refused':
      return 'Not delivered';
    case 'dismissed':
      return 'Dismissed';
  }
}

/** Long words fold to a few lines, with a press to read them all. */
const LONG = 280;

/**
 * A message between two of your chats (ADR 0134). Sent: “To “Fix the login””
 * with what it said and whether it's been read. Come here: “From “Release
 * notes””, marked as another chat's words, never yours, with Pass it on and
 * Dismiss while it's held, and this chat's own choice of whether to take them.
 */
export function ChatMessageCard({
  direction,
  kind = 'message',
  chatTitle,
  text,
  state,
  wakes,
  why,
  onOpenChat,
  onPass,
  onDismiss,
  inbound,
  onInboundChange,
  className,
  ...props
}: ChatMessageCardProps) {
  const [open, setOpen] = useState(text.length <= LONG);
  const textId = useId();
  const stop = kind === 'stop';
  const Icon = stop ? CircleStop : direction === 'out' ? Send : Inbox;
  const lead = stop
    ? direction === 'out'
      ? 'Stopped'
      : 'Stopped by'
    : direction === 'out'
      ? 'To'
      : 'From';
  const name = `“${chatTitle}”`;
  const label = `${stop ? (direction === 'out' ? 'Stopped' : 'Stopped by') : direction === 'out' ? 'Message to' : 'Message from'} ${name}${direction === 'in' ? ', another of your chats' : ''}`;
  const held = state === 'held' && direction === 'in';
  return (
    <article
      aria-label={label}
      className={cx(styles.message, className)}
      data-direction={direction}
      data-state={state}
      {...props}
    >
      <header className={styles.messageHead}>
        <Icon aria-hidden className={styles.messageIcon} />
        <span className={styles.messageWho}>
          {lead}{' '}
          {onOpenChat ? (
            <button type="button" className={styles.chatLink} onClick={onOpenChat}>
              {name}
            </button>
          ) : (
            name
          )}
          {direction === 'in' && (
            <span className={styles.messageAside}> · another chat, not you</span>
          )}
        </span>
        {!stop && (
          <span className={styles.messageState} data-state={state}>
            {chatMessageStateWords(state, direction, wakes)}
          </span>
        )}
        {direction === 'in' && onInboundChange && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton size="sm" variant="ghost" label="Messages from other chats">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Label>Messages from your other chats</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={inbound ?? 'accept'}
                onValueChange={(value) => onInboundChange(value as ChatInboundChoice)}
              >
                {INBOUND.map((choice) => (
                  <DropdownMenu.RadioItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
      </header>
      <p id={textId} className={styles.messageText} data-open={open || undefined}>
        {text}
      </p>
      {!open && (
        <button
          type="button"
          className={styles.more}
          aria-controls={textId}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Show all
        </button>
      )}
      {why && <p className={styles.why}>{why}</p>}
      {held && (onPass || onDismiss) && (
        <div className={styles.messageActions}>
          {onPass && (
            <Button size="sm" onClick={onPass}>
              Pass it on
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" tone="neutral" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

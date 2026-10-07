import { AlertCircle, RotateCcw } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { AgentAvatar, type Speaker } from '../AgentAvatar/AgentAvatar';
import styles from './Message.module.css';

export type MessageFrom = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'streaming' | 'error';

export interface MessageProps extends Omit<ComponentProps<'article'>, 'children'> {
  from: MessageFrom;
  children?: ReactNode;
  /**
   * Who is speaking: a name, and for an agent how it looks (a preset's id or
   * a picture's address, see `AgentAvatar`). Defaults to "You" for your
   * turns and to Conch, in its mark, for the assistant's.
   */
  speaker?: Speaker;
  /**
   * The same speaker as the turn just before, with nothing between: the
   * reply goes on without its speaker line, as one voice keeps talking. It
   * is still named, once, for assistive tech.
   */
  continued?: boolean;
  timestamp?: Date | string;
  /**
   * More about the turn, quietly, on the speaker line beside its time: the
   * model that answered. Shown on hover or focus where there's a pointer.
   */
  meta?: ReactNode;
  /**
   * What belongs to the reply after its words: tool rows, a plan, a question,
   * an offer, replies to send next. Drawn in the reply's column one step under
   * the words (`--nc-chat-step`) and before the actions, so the actions
   * never sit between the words and their card. Each part places itself with
   * `--nc-chat-flow-gap` and `--nc-chat-indent`, which the slot sets.
   */
  attached?: ReactNode;
  /** Action bar (copy, retry, …) revealed on hover / focus. Use small ghost IconButtons. */
  actions?: ReactNode;
  /** `hover` (default) reveals actions on hover/focus; `always` keeps them visible. */
  actionsVisibility?: 'hover' | 'always';
  status?: MessageStatus;
  /**
   * The speaker is still at work on this turn, words or not (a step running,
   * more to come): their face moves. Defaults to `status === 'streaming'`.
   */
  working?: boolean;
  /**
   * Play the "surfacing" entrance on mount (turn off when it replaces a
   * placeholder in place). Read once, when the message mounts: changing it
   * later never replays the entrance on a message already on screen.
   */
  entrance?: boolean;
  /**
   * Epoch ms when the work this message shows began. The moving face keeps
   * time from it, so a reply that takes a placeholder's place carries the
   * spiral on where it was instead of starting it again.
   */
  since?: number;
  /** Error description shown when `status="error"`. */
  error?: ReactNode;
  onRetry?: () => void;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function Timestamp({ value }: { value: Date | string }) {
  if (typeof value === 'string') return <span className={styles.time}>{value}</span>;
  return (
    <time className={styles.time} dateTime={value.toISOString()}>
      {timeFormat.format(value)}
    </time>
  );
}

/**
 * One turn in a conversation. Your turns are soft accent-tinted bubbles at
 * the end of the column. The assistant's use the whole column: one compact
 * line says who is speaking (their face, their name, and quietly when and
 * with which model), and the answer starts under it, flush with everything
 * else in the chat. While `status="streaming"` the face comes alive and a
 * breathing pearl caret follows the last line.
 */
export function Message({
  from,
  children,
  speaker,
  continued = false,
  timestamp,
  meta,
  attached,
  actions,
  actionsVisibility = 'hover',
  status = 'complete',
  working = status === 'streaming',
  entrance = true,
  since,
  error,
  onRetry,
  className,
  ...props
}: MessageProps) {
  const headingId = useId();
  // Decided when it mounts: a message already on screen never surfaces twice.
  const [entered] = useState(entrance);
  const name = speaker?.name ?? (from === 'user' ? 'You' : 'Conch');

  if (from === 'system') {
    return (
      <article
        aria-labelledby={headingId}
        data-from="system"
        className={cx(styles.message, styles.system, className)}
        {...props}
      >
        <h2 id={headingId} className="nc-visually-hidden">
          System notice
        </h2>
        <span className={styles.systemText}>{children}</span>
        {timestamp && <Timestamp value={timestamp} />}
      </article>
    );
  }

  const body = (
    <>
      <div
        className={from === 'user' ? styles.bubble : styles.content}
        data-streaming={status === 'streaming' || undefined}
      >
        {children}
      </div>
      {status === 'error' && (
        <div className={styles.error} role="alert">
          <AlertCircle aria-hidden className={styles.errorIcon} />
          <span>{error ?? 'Something went wrong.'}</span>
          {onRetry && (
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              leadingIcon={<RotateCcw />}
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {attached != null && (
        <div className={styles.attached} data-attached="">
          {attached}
        </div>
      )}
    </>
  );
  const actionBar = actions && status !== 'streaming' && (
    <div className={styles.actions} data-visibility={actionsVisibility}>
      {actions}
    </div>
  );

  if (from === 'assistant') {
    return (
      <article
        aria-labelledby={headingId}
        aria-busy={status === 'streaming' || undefined}
        data-from="assistant"
        data-status={status}
        data-continued={continued || undefined}
        data-entrance={entered ? undefined : 'none'}
        className={cx(styles.message, className)}
        {...props}
      >
        {continued ? (
          <h2 id={headingId} className="nc-visually-hidden">
            {name} said:
          </h2>
        ) : (
          <MessageSpeaker
            speaker={{ name, avatar: speaker?.avatar }}
            headingId={headingId}
            active={working}
            since={since}
            timestamp={timestamp}
            meta={meta}
          />
        )}
        {body}
        {actionBar}
      </article>
    );
  }

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={status === 'streaming' || undefined}
      data-from={from}
      data-status={status}
      data-entrance={entered ? undefined : 'none'}
      className={cx(styles.message, className)}
      {...props}
    >
      <h2 id={headingId} className="nc-visually-hidden">
        {name} said:
      </h2>
      <div className={styles.main}>
        {body}
        {/* When it was sent and what you can do with it, on one quiet line. */}
        {(timestamp || actionBar) && (
          <div className={styles.userFoot}>
            {timestamp && (
              <div className={styles.userMeta}>
                <Timestamp value={timestamp} />
              </div>
            )}
            {actionBar}
          </div>
        )}
      </div>
    </article>
  );
}

export interface MessageSpeakerProps extends Omit<ComponentProps<'div'>, 'children'> {
  speaker: Speaker;
  /** The name is the turn's heading: the id the turn is labelled by. */
  headingId?: string;
  /** The speaker is working on this turn right now. */
  active?: boolean;
  /** Epoch ms the work began. */
  since?: number;
  timestamp?: Date | string;
  /** The model that answered, or another quiet word about the turn. */
  meta?: ReactNode;
}

/**
 * The line over a reply that says who is speaking: a small face, the name,
 * and — quietly, on hover or focus where there's a pointer — when, and with
 * which model. The name is the turn's heading (“Conch said:”), so it's read
 * once per turn, never per paragraph; the face beside it is decoration.
 */
export function MessageSpeaker({
  speaker,
  headingId,
  active,
  since,
  timestamp,
  meta,
  className,
  ...props
}: MessageSpeakerProps) {
  const hasMeta = meta != null && meta !== false && meta !== '';
  return (
    <div className={cx(styles.speaker, className)} {...props}>
      <AgentAvatar
        name={speaker.name}
        avatar={speaker.avatar}
        size="xs"
        decorative
        active={active}
        since={since}
      />
      <h2 id={headingId} className={styles.author}>
        {speaker.name} <span className="nc-visually-hidden">said:</span>
      </h2>
      {(hasMeta || timestamp) && (
        <span className={styles.meta}>
          {hasMeta && <span className={styles.model}>{meta}</span>}
          {hasMeta && timestamp && <span aria-hidden> · </span>}
          {timestamp && <Timestamp value={timestamp} />}
        </span>
      )}
    </div>
  );
}

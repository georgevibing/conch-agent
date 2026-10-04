import { AlertCircle, RotateCcw } from 'lucide-react';
import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Message.module.css';

export type MessageFrom = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'streaming' | 'error';

export interface MessageProps extends Omit<ComponentProps<'article'>, 'children'> {
  from: MessageFrom;
  children?: ReactNode;
  /** Display name. Defaults to "You" / "Claude". */
  author?: string;
  /** Custom avatar for assistant messages. Defaults to the pearl mark. */
  avatar?: ReactNode;
  timestamp?: Date | string;
  /**
   * What belongs to the reply after its words: tool rows, a plan, a question,
   * an offer, replies to send next. Drawn in the text column one step under
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
   * Play the "surfacing" entrance on mount (turn off when it replaces a
   * placeholder in place). Read once, when the message mounts: changing it
   * later never replays the entrance on a message already on screen.
   */
  entrance?: boolean;
  /**
   * Epoch ms when the work this message shows began. The moving mark keeps
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
 * The assistant's mark: a small glazed tile with a pearl rim. While `active`,
 * the conch spiral draws itself from the centre out, flows away and grows
 * again — a shell forming — as the rim's light orbits. When work finishes a
 * single ring of light passes around it.
 */
export function MessageMark({
  active,
  since,
  className,
  style,
  ...props
}: ComponentProps<'span'> & {
  active?: boolean;
  /** Epoch ms the work began: the spiral keeps time from it across remounts. */
  since?: number;
}) {
  const [landed, setLanded] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  // How far into its loops the mark is, read when it starts moving and then fixed,
  // so a re-render never shifts a running animation.
  const [age, setAge] = useState(() => (active ? ageOf(since) : 0));
  if (Boolean(active) !== Boolean(wasActive)) {
    setWasActive(active);
    if (!active) setLanded(true);
    else setAge(ageOf(since));
  }
  useEffect(() => {
    if (!landed) return;
    const id = setTimeout(() => setLanded(false), 1200);
    return () => clearTimeout(id);
  }, [landed]);
  return (
    <span
      aria-hidden
      data-active={active || undefined}
      data-landed={landed || undefined}
      className={cx(styles.mark, className)}
      style={{ '--nc-mark-age': `${age}ms`, ...style } as CSSProperties}
      {...props}
    >
      <svg viewBox="3.5 3.5 17 17" className={styles.markGlyph}>
        {/* Conch's mark: a shell spiral of growing quarter-arcs (a golden spiral). */}
        <path
          pathLength={1}
          d="M12 12a1.5 1.5 0 0 1 1.5 1.5a3 3 0 0 1-3 3a4.5 4.5 0 0 1-4.5-4.5a6 6 0 0 1 6-6a7.5 7.5 0 0 1 7.5 7.5"
          transform="translate(0 -1.5)"
        />
      </svg>
    </span>
  );
}

function ageOf(since: number | undefined): number {
  return since === undefined ? 0 : Math.max(0, Date.now() - since);
}

/**
 * One turn in a conversation. User turns are soft accent-tinted bubbles
 * aligned to the end; assistant turns are full-width prose with a mark.
 * While `status="streaming"` a breathing pearl caret follows the last line.
 */
export function Message({
  from,
  children,
  author,
  avatar,
  timestamp,
  attached,
  actions,
  actionsVisibility = 'hover',
  status = 'complete',
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
  const name = author ?? (from === 'user' ? 'You' : from === 'assistant' ? 'Claude' : 'System');

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
      {actions && status !== 'streaming' && (
        <div className={styles.actions} data-visibility={actionsVisibility}>
          {actions}
        </div>
      )}
    </>
  );

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
      {from === 'assistant' ? (
        <>
          <div className={styles.avatar}>
            {avatar ?? <MessageMark active={status === 'streaming'} since={since} />}
          </div>
          <div className={styles.main}>
            <div className={styles.meta}>
              <span className={styles.author} aria-hidden>
                {name}
              </span>
              {timestamp && <Timestamp value={timestamp} />}
            </div>
            {body}
          </div>
        </>
      ) : (
        <div className={styles.main}>
          {body}
          {timestamp && (
            <div className={styles.userMeta}>
              <Timestamp value={timestamp} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

import { useState } from 'react';

import { Avatar } from '../../components/Avatar';
import { cx } from '../../utils/cx';
import { useNow } from '../Usage/useNow';
import {
  count,
  outside,
  ShowAll,
  useShowAll,
  ViewFrame,
  webLink,
  type ViewFrameProps,
} from './shared';
import { dayKey, fullWhen, shortWhen, timeOf, type WhenOptions } from './time';
import styles from './ToolViews.module.css';

/** One message from a chat app. Mirrors `ChatMessageItem` in `@conch/protocol`. */
export interface ChatMessage {
  author: string;
  text: string;
  /** ISO date-time it was said. */
  at: string;
  url?: string;
}

export interface ChatMessagesProps extends Omit<ViewFrameProps, 'label' | 'heading'>, WhenOptions {
  messages: ChatMessage[];
  /** Where they were said: "#design". */
  place?: string;
  /** "Messages": what it's called for screen readers. */
  label?: string;
}

/** Long messages fold to a few lines with More; past these, a message is long. */
const LONG_CHARS = 320;
const LONG_LINES = 4;
/** One person's messages this close together read as one. */
const RUN_MS = 5 * 60_000;

function Text({ text }: { text: string }) {
  const long = text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className={styles.text} data-clamped={(long && !open) || undefined}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          className={styles.moreText}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </>
  );
}

/**
 * Messages from a chat app (ADR 0060): where they were said, then each with
 * who said it, when, and what, oldest first, the way the app shows them. A
 * long one folds to a few lines with More. Line breaks are kept; nothing is
 * read as markup.
 */
export function ChatMessages({
  messages,
  place,
  label = 'Messages',
  now: nowProp,
  locale,
  timeZone,
  className,
  ...props
}: ChatMessagesProps) {
  const now = useNow(60_000, nowProp);
  const options: WhenOptions = { now, locale, timeZone };
  const ordered = [...messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const { folded, showAll, limit } = useShowAll(ordered.length);
  // The newest are what's wanted; the earlier ones wait above.
  const shown = folded ? ordered.slice(-limit) : ordered;
  const today = dayKey(now, timeZone);
  return (
    <ViewFrame
      label={`${place ? `${label} in ${place}` : label}, ${count(messages.length, 'message')}`}
      heading={place}
      className={cx(styles.messages, className)}
      {...props}
    >
      {folded && <ShowAll onClick={showAll}>Show all {count(messages.length, 'message')}</ShowAll>}
      {messages.length === 0 ? (
        <p className={styles.empty}>No messages.</p>
      ) : (
        <ul className={styles.rows}>
          {shown.map((m, i) => {
            const before = shown[i - 1];
            const ts = Date.parse(m.at);
            const continued = before?.author === m.author && ts - Date.parse(before.at) < RUN_MS;
            const url = webLink(m.url);
            const when =
              dayKey(ts, timeZone) === today
                ? timeOf(ts, options)
                : `${shortWhen(m.at, options)} ${timeOf(ts, options)}`;
            const time = (
              <time dateTime={m.at} title={fullWhen(m.at, options)}>
                {when}
              </time>
            );
            return (
              <li
                key={`${m.at}${i}`}
                className={styles.message}
                data-continued={continued || undefined}
              >
                <span className={styles.avatar} aria-hidden>
                  {!continued && <Avatar name={m.author} size="xs" />}
                </span>
                <div className={styles.body}>
                  <div className={cx(styles.byline, continued && 'nc-visually-hidden')}>
                    <span className={styles.author}>{m.author}</span>
                    <span className={styles.at}>
                      {url ? (
                        <a href={url} {...outside} className={styles.atLink}>
                          {time}
                          <span className="nc-visually-hidden">, open in its app</span>
                        </a>
                      ) : (
                        time
                      )}
                    </span>
                  </div>
                  <Text text={m.text} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ViewFrame>
  );
}

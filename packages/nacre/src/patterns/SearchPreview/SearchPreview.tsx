import { Wrench } from 'lucide-react';
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';

import { Highlight, type HighlightRange } from '../../components/Highlight';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../utils/cx';
import { MessageMark } from '../AgentAvatar/AgentAvatar';
import styles from './SearchPreview.module.css';

export interface SearchPreviewMessage {
  id: string;
  from: 'user' | 'assistant' | 'tool';
  author: string;
  time?: string;
  text: string;
  ranges?: readonly HighlightRange[];
  /** The message the preview is about (the search hit). */
  focus?: boolean;
  clippedStart?: boolean;
  clippedEnd?: boolean;
}

export interface SearchPreviewProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  /** A line under the title, e.g. "Mar 3 · 42 messages". */
  meta?: ReactNode;
  messages?: SearchPreviewMessage[];
  loading?: boolean;
  /** Shown pinned at the bottom, e.g. "↵ Open at this message". */
  footer?: ReactNode;
}

/**
 * A glance into a conversation beside search results: the matching message
 * in its context, matches marked, so you know it's the right one before you
 * open it. Quiet by design — the focused message carries the only emphasis.
 */
export function SearchPreview({
  title,
  meta,
  messages = [],
  loading = false,
  footer,
  className,
  ...props
}: SearchPreviewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const focusId = messages.find((m) => m.focus)?.id;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const focused = el.querySelector<HTMLElement>('[data-focus]');
    if (!focused) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const mark = focused.querySelector('mark') ?? focused;
    const top = (mark as HTMLElement).offsetTop - el.offsetTop - el.clientHeight * 0.3;
    el.scrollTop = Math.max(0, top);
  }, [focusId, messages]);

  return (
    <section className={cx(styles.root, className)} aria-label="Preview" {...props}>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {meta && <p className={styles.meta}>{meta}</p>}
      </header>
      <div ref={scroller} className={styles.scroll}>
        {loading && !messages.length ? (
          <div className={styles.loading}>
            <Skeleton height="0.75rem" width="40%" />
            <Skeleton height="0.75rem" />
            <Skeleton height="0.75rem" width="85%" />
            <Skeleton height="0.75rem" width="30%" />
            <Skeleton height="0.75rem" width="70%" />
          </div>
        ) : (
          messages.map((m) => (
            <article
              key={m.id}
              className={styles.message}
              data-from={m.from}
              data-focus={m.focus || undefined}
            >
              <div className={styles.byline}>
                {m.from === 'assistant' ? (
                  <MessageMark className={styles.mark} />
                ) : m.from === 'tool' ? (
                  <span className={styles.toolIcon} aria-hidden>
                    <Wrench />
                  </span>
                ) : null}
                <span className={styles.author}>{m.author}</span>
                {m.time && <span className={styles.time}>{m.time}</span>}
              </div>
              <p className={styles.text}>
                <Highlight
                  text={m.text}
                  ranges={m.ranges ?? []}
                  tone={m.focus ? 'strong' : 'soft'}
                />
              </p>
            </article>
          ))
        )}
      </div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}

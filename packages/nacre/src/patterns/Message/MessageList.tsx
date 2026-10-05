import { ArrowDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../utils/cx';
import styles from './MessageList.module.css';

export interface MessageListProps extends ComponentProps<'div'> {
  /** Accessible name of the conversation log. */
  'aria-label'?: string;
  /** Distance from the bottom (px) within which the view stays pinned. */
  stickThreshold?: number;
  /** Layered over the scrolling log (e.g. a find bar and its match rail). */
  overlay?: ReactNode;
  /**
   * Changes when the reader does something that should bring them to the
   * newest message wherever they were (e.g. the id of the message they just
   * sent): the view goes to the bottom and follows again. Going back to
   * `undefined` leaves it where it is.
   */
  follow?: unknown;
  /**
   * The conversation is still on its way. A quiet outline of one shows (only
   * if the wait is long enough to notice); then the whole conversation
   * arrives at once, already at its newest message, instead of piling in.
   */
  loading?: boolean;
}

/**
 * Scrollable conversation log. Stays pinned to the newest message while the
 * reader is at the bottom (including while text streams in); if they scroll
 * up to read, it stops following and offers a "Jump to latest" pill.
 */
export function MessageList({
  children,
  className,
  stickThreshold = 48,
  overlay,
  follow,
  loading = false,
  'aria-label': ariaLabel = 'Conversation',
  ...props
}: MessageListProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Faded in once, when what was loading arrives; a conversation already here just shows.
  const [waited, setWaited] = useState(loading);
  if (loading && !waited) setWaited(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = viewport.current;
    if (!el) return;
    if (behavior === 'smooth' && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Before the first paint, so a conversation is never seen anywhere but at its newest message.
  useLayoutEffect(() => {
    const el = viewport.current;
    const inner = content.current;
    if (!el || !inner) return;
    // Only reading upwards lets go of the bottom. A scroll event can land after
    // more of the chat has arrived below (a reply streaming in, a picture
    // loading), which leaves it far from the bottom without the reader moving.
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const distance = el.scrollHeight - top - el.clientHeight;
      if (distance <= stickThreshold) pinned.current = true;
      else if (top < lastTop) pinned.current = false;
      lastTop = top;
      if (pinned.current) setShowJump(false);
    };
    // The list itself getting shorter (a phone's keyboard coming up) keeps the
    // newest message in view too; only new content offers the pill.
    const observer = new ResizeObserver((entries) => {
      if (pinned.current) scrollToBottom();
      else if (entries.some((entry) => entry.target === inner)) setShowJump(true);
    });
    observer.observe(inner);
    observer.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    scrollToBottom();
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [scrollToBottom, stickThreshold]);

  // What was loading is here: it opens at its newest message, before it's seen.
  useLayoutEffect(() => {
    if (loading) return;
    pinned.current = true;
    scrollToBottom();
  }, [loading, scrollToBottom]);

  const followed = useRef(follow);
  useEffect(() => {
    const changed = !Object.is(followed.current, follow);
    followed.current = follow;
    // Back to nothing is no news.
    if (!changed || follow === undefined) return;
    pinned.current = true;
    setShowJump(false);
    scrollToBottom();
  }, [follow, scrollToBottom]);

  return (
    <div className={cx(styles.root, className)} data-loading={loading || undefined} {...props}>
      <div ref={viewport} className={styles.viewport}>
        <div
          ref={content}
          role="log"
          aria-label={ariaLabel}
          aria-live="polite"
          aria-relevant="additions"
          aria-busy={loading || undefined}
          className={styles.content}
          data-arrived={waited && !loading ? '' : undefined}
        >
          {loading ? <Opening /> : children}
        </div>
      </div>
      {overlay}
      {showJump && !loading && (
        <div className={styles.jump}>
          <Button
            size="sm"
            variant="surface"
            className={styles.jumpButton}
            leadingIcon={<ArrowDown />}
            onClick={() => {
              pinned.current = true;
              setShowJump(false);
              scrollToBottom('smooth');
            }}
          >
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

/** The outline of a conversation, resting where its newest messages will be. */
function Opening() {
  return (
    <div className={styles.opening} role="status" aria-label="Opening the conversation">
      <Skeleton shape="block" className={styles.openingMine} />
      <Skeleton lines={3} className={styles.openingReply} />
      <Skeleton shape="block" className={styles.openingMine} data-short="" />
      <Skeleton lines={4} className={styles.openingReply} />
    </div>
  );
}

import { ArrowDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
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
  'aria-label': ariaLabel = 'Conversation',
  ...props
}: MessageListProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = viewport.current;
    if (!el) return;
    if (behavior === 'smooth' && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const el = viewport.current;
    const inner = content.current;
    if (!el || !inner) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinned.current = distance <= stickThreshold;
      if (pinned.current) setShowJump(false);
    };
    const observer = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
      else setShowJump(true);
    });
    observer.observe(inner);
    el.addEventListener('scroll', onScroll, { passive: true });
    scrollToBottom();
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [scrollToBottom, stickThreshold]);

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
    <div className={cx(styles.root, className)} {...props}>
      <div ref={viewport} className={styles.viewport}>
        <div
          ref={content}
          role="log"
          aria-label={ariaLabel}
          aria-live="polite"
          aria-relevant="additions"
          className={styles.content}
        >
          {children}
        </div>
      </div>
      {overlay}
      {showJump && (
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

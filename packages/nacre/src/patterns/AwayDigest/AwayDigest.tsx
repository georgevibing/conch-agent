import { ArrowDownRight, X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { formatWorked } from '../ThinkingIndicator/ThinkingIndicator';
import { StoryMark, type StoryStatus } from '../Story/Story';
import type { StoryFamily } from '../Story/types';
import styles from './AwayDigest.module.css';

export interface AwayDigestItem {
  /** The story's id: what `onJump` is given. */
  id: string;
  headline: string;
  outcome?: string;
  family: StoryFamily;
  status: StoryStatus;
}

export interface AwayDigestProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** What happened while the tab was hidden, oldest first. */
  items: AwayDigestItem[];
  /** How long it worked meanwhile. */
  durationMs?: number;
  /** Go to that story in the chat. Each line becomes a press. */
  onJump?: (id: string) => void;
  /** Put the card away. It folds out of its place first, then this is called. */
  onDismiss?: () => void;
  /** How many lines show before "and N more". Default 5. */
  max?: number;
}

/** How long the card takes to fold away before `onDismiss`. */
const LEAVE_MS = 260;

/**
 * "Worked 12m · 2 done · 1 didn’t work". Each line is a story (a run of
 * steps told as one thing), so it counts what got done, never "steps".
 */
function digestLine(items: AwayDigestItem[], durationMs?: number): string {
  const parts: string[] = [];
  if (durationMs !== undefined) parts.push(`Worked ${formatWorked(durationMs)}`);
  const done = items.filter((i) => i.status === 'done').length;
  if (done) parts.push(`${done} done`);
  const skipped = items.filter((i) => i.status === 'declined').length;
  if (skipped) parts.push(`${skipped} not run`);
  const failed = items.filter((i) => i.status === 'failed').length;
  if (failed) parts.push(`${failed} didn’t work`);
  const running = items.some((i) => i.status === 'running');
  if (running) parts.push('still going');
  return parts.join(' · ');
}

/**
 * "While you were away": when you come back to a chat that kept working
 * with its tab hidden, a soft card says what happened, a line per story,
 * the lines arriving one after another. Press a line to go to it; dismiss
 * the card and it folds out of its place.
 */
export function AwayDigest({
  items,
  durationMs,
  onJump,
  onDismiss,
  max = 5,
  className,
  ...props
}: AwayDigestProps) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = () => {
    setLeaving(true);
    timer.current = setTimeout(() => onDismiss?.(), LEAVE_MS);
  };
  const shown = items.slice(-max);
  const earlier = items.length - shown.length;

  return (
    <section
      className={cx(styles.card, className)}
      aria-label="While you were away"
      data-leaving={leaving || undefined}
      {...props}
    >
      <div className={styles.inner}>
        <header className={styles.head}>
          <div className={styles.titles}>
            <h3 className={styles.title}>While you were away</h3>
            <p className={styles.line}>{digestLine(items, durationMs)}</p>
          </div>
          {onDismiss && (
            <IconButton
              label="Dismiss"
              size="sm"
              variant="ghost"
              tone="neutral"
              className={styles.dismiss}
              onClick={dismiss}
            >
              <X />
            </IconButton>
          )}
        </header>
        <ol className={styles.items}>
          {earlier > 0 && (
            <li className={styles.earlier} style={{ '--i': 0 } as CSSProperties}>
              {earlier} more before these
            </li>
          )}
          {shown.map((item, i) => {
            const body = (
              <>
                <StoryMark family={item.family} status={item.status} />
                <span className={styles.text}>
                  <span className={styles.headline}>{item.headline}</span>
                  {item.outcome && (
                    <>
                      {' '}
                      <span className={styles.dot} aria-hidden>
                        ·
                      </span>
                      <span className={styles.outcome}>{item.outcome}</span>
                    </>
                  )}
                  {item.status === 'failed' && (
                    <span className="nc-visually-hidden">, didn’t work</span>
                  )}
                  {item.status === 'running' && (
                    <span className="nc-visually-hidden">, still going</span>
                  )}
                </span>
                {onJump && <ArrowDownRight aria-hidden className={styles.go} />}
              </>
            );
            return (
              <li
                key={item.id}
                className={styles.item}
                style={{ '--i': i + (earlier > 0 ? 1 : 0) } as CSSProperties}
              >
                {onJump ? (
                  <button type="button" className={styles.row} onClick={() => onJump(item.id)}>
                    {body}
                  </button>
                ) : (
                  <div className={styles.row}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

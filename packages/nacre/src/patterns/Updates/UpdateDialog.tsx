import { Check } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Callout } from '../../components/Callout';
import { Dialog } from '../../components/Dialog';
import { cx } from '../../utils/cx';
import { usePrefersReducedMotion } from '../../utils/useMediaQuery';
import { CopyButton } from '../CopyButton';
import { PearlProgress, type PearlProgressState } from './PearlProgress';
import styles from './UpdateDialog.module.css';

export type UpdateDialogStage =
  /** What's coming, and one press to have it. */
  | 'ready'
  /** Getting it ready while you keep working. */
  | 'updating'
  /** Starting again on the new version. */
  | 'restarting'
  /** Back, on the new version: what arrived. */
  | 'done'
  /** It didn't work, or one press can't do it: why, and what to do. */
  | 'failed';

export interface UpdateDialogProgress {
  /** "Installing" */
  label: string;
  /** Overall, 0–100; omit when it can't be known. */
  value?: number;
  step?: number;
  steps?: number;
}

export interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: UpdateDialogStage;
  /** "16 improvements are ready", "Conch 0.4 is ready", "You’re on the new Conch". */
  title: ReactNode;
  /** One quiet line: "You have 0.3.1 · main a1b2c3d → f00ba12". */
  detail?: ReactNode;
  /** What it brings, newest first, in plain words. */
  changes?: string[];
  /** A release's own notes (`ReleaseNotes`), shown instead of `changes` when it's ready or done. */
  notes?: ReactNode;
  /** Changes beyond the ones listed: "and 7 more". */
  more?: number;
  /** The heading over the list. */
  changesLabel?: string;
  progress?: UpdateDialogProgress;
  /** The buttons, the main one last. */
  action?: ReactNode;
  /** A reassuring line beside the buttons. */
  footnote?: ReactNode;
  /** It didn't work, or can't be done here: why, and a command to run by hand. */
  notice?: { tone: 'warning' | 'danger'; message: ReactNode; command?: string };
  /** Taking longer than it should: what to do, calmly. */
  slow?: ReactNode;
}

const PEARL: Record<UpdateDialogStage, PearlProgressState> = {
  ready: 'resting',
  updating: 'working',
  restarting: 'restarting',
  done: 'done',
  failed: 'failed',
};

/** How long the reading light rests on each line while it updates. */
const BEAT_MS = 1600;

/**
 * While it updates, a soft light moves down what's coming, one line at a
 * time, so there's something worth reading while you wait. It follows the
 * list into view until you scroll it yourself.
 */
function useReadingLight(count: number, on: boolean) {
  const reduced = usePrefersReducedMotion();
  const [lit, setLit] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const yours = useRef(false);
  useEffect(() => {
    if (!on || reduced || count < 2) return;
    const timer = setInterval(() => setLit((i) => (i + 1) % count), BEAT_MS);
    return () => clearInterval(timer);
  }, [on, reduced, count]);
  useEffect(() => {
    if (!on || reduced || yours.current) return;
    const item = list.current?.children[lit];
    item?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [lit, on, reduced]);
  const stop = useCallback(() => {
    yours.current = true;
  }, []);
  return [on && !reduced && count > 1 ? lit : undefined, list, stop] as const;
}

/**
 * Conch's own update, from anywhere: what the next version brings, one
 * press, and the update itself — the pearl grows a ring of nacre as it comes
 * together, ripples while Conch starts again, and blooms once when you're on
 * the new version. It only moves forward: the same dialog carries you from
 * "ready" to "done", and you can close it and keep working at any point.
 */
export function UpdateDialog({
  open,
  onOpenChange,
  stage,
  title,
  detail,
  changes = [],
  notes,
  more = 0,
  changesLabel,
  progress,
  action,
  footnote,
  notice,
  slow,
}: UpdateDialogProps) {
  const moving = stage === 'updating' || stage === 'restarting';
  const label =
    changesLabel ??
    (stage === 'done' ? 'What’s new' : moving ? 'Coming with this update' : 'What it brings');
  const list = notes && (stage === 'ready' || stage === 'done') ? undefined : changes;
  const [lit, listRef, yours] = useReadingLight(list?.length ?? 0, moving);
  const stepText =
    stage === 'updating' && progress?.step && progress.steps
      ? `Step ${progress.step} of ${progress.steps}`
      : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" className={styles.dialog} data-stage={stage}>
        <div
          className={styles.hero}
          // Nothing below it (starting again): the words get room before the edge.
          data-alone={
            !(list?.length || (notes && (stage === 'ready' || stage === 'done'))) &&
            !notice &&
            !slow &&
            !action &&
            !footnote
              ? ''
              : undefined
          }
        >
          <PearlProgress
            state={PEARL[stage]}
            value={stage === 'updating' ? progress?.value : undefined}
            className={styles.pearl}
          />
          <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          <Dialog.Description className={styles.detail}>
            {stage === 'updating' && progress ? (
              <>
                <span className={styles.step}>{progress.label}</span>
                {[stepText, progress.value !== undefined && `${Math.round(progress.value)}%`]
                  .filter(Boolean)
                  .map((part) => ` · ${part as string}`)
                  .join('')}
              </>
            ) : (
              detail
            )}
          </Dialog.Description>
          {/* Said politely as it moves along, never every percent. */}
          <span className={styles.srOnly} role="status" aria-live="polite">
            {stage === 'updating' ? progress?.label : stage === 'restarting' ? title : ''}
          </span>
        </div>

        {(list?.length || (notes && (stage === 'ready' || stage === 'done'))) && (
          <Dialog.Body
            className={styles.body}
            onWheel={yours}
            onTouchMove={yours}
            onKeyDown={yours}
          >
            <p className={styles.label}>{label}</p>
            {list?.length ? (
              <ul ref={listRef} className={styles.changes} data-moving={moving || undefined}>
                {list.map((line, index) => (
                  <li
                    key={line}
                    className={styles.change}
                    data-lit={lit === index || undefined}
                    style={{ ['--ud-i' as string]: index } as CSSProperties}
                  >
                    {stage === 'done' ? (
                      <Check aria-hidden className={styles.check} />
                    ) : (
                      <span aria-hidden className={styles.dot} />
                    )}
                    <span className={styles.line}>{line}</span>
                  </li>
                ))}
                {more > 0 && (
                  <li className={cx(styles.change, styles.more)}>
                    <span aria-hidden className={styles.dotless} />
                    <span className={styles.line}>
                      and {more} more {more === 1 ? 'change' : 'changes'}
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <div className={styles.notes}>{notes}</div>
            )}
          </Dialog.Body>
        )}

        {notice && (
          <div className={styles.notice}>
            <Callout tone={notice.tone} live="polite">
              <p>{notice.message}</p>
              {notice.command && (
                <div className={styles.command}>
                  <code>{notice.command}</code>
                  <CopyButton value={notice.command} label="Copy command" />
                </div>
              )}
            </Callout>
          </div>
        )}
        {slow && <p className={styles.slow}>{slow}</p>}

        {(action || footnote) && (
          <Dialog.Footer className={styles.footer}>
            {footnote && <p className={styles.footnote}>{footnote}</p>}
            {action && <div className={styles.actions}>{action}</div>}
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

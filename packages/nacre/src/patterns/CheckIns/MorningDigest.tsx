import { GitMerge, PenLine, Sparkles, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './MorningDigest.module.css';
import { META_SEP } from '../../components/MetaList';

/*
 * The morning's note (ADR 0107): what Conch learned from your chats and how it
 * tidied its memory overnight, in a few lines, each with Undo. It asks for
 * nothing: it's there to read once, then folds away. It lives at the top of
 * Settings → What Conch knows and nowhere else: never in a chat or on the new chat's
 * screen, never a push (ADR 0097, ADR 0107).
 */

export type DigestKind = 'learned' | 'replaced' | 'merged' | 'tidied';

export interface DigestLine {
  id: string;
  kind: DigestKind;
  /** The memory as it is now. */
  text: string;
  /** What it replaced, for `replaced`. */
  was?: string;
  /** `undone`: you took it back; it stays, struck through, until the card goes. */
  state: 'applied' | 'undone';
}

export interface MorningDigestProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  /** “While you slept”, or “Since you last looked” later in the day. */
  title?: string;
  /** “Learned 2 things · tidied 3”. Worked out from the lines when left out. */
  line?: ReactNode;
  items: DigestLine[];
  onUndo?: (id: string) => void;
  /** The line being undone. */
  busy?: string;
  /** Got it: it folds out of its place, then this is called. */
  onDismiss?: () => void;
  /** Lines before “and N more”. Default 5. */
  max?: number;
}

const LEAVE_MS = 260;

const ICONS = { learned: Sparkles, replaced: PenLine, merged: GitMerge, tidied: PenLine } as const;
const SAID: Record<DigestKind, string> = {
  learned: 'Learned',
  replaced: 'Now',
  merged: 'Merged',
  tidied: 'Tidied',
};

/** “Learned 2 things · tidied 3”, counting only what still stands. */
export function digestLine(items: readonly DigestLine[]): string {
  const live = items.filter((i) => i.state === 'applied');
  const learned = live.filter((i) => i.kind === 'learned' || i.kind === 'replaced').length;
  const tidied = live.length - learned;
  const parts: string[] = [];
  if (learned) parts.push(`Learned ${learned} thing${learned === 1 ? '' : 's'}`);
  if (tidied) parts.push(`${parts.length ? 'tidied' : 'Tidied'} ${tidied}`);
  return parts.join(META_SEP) || 'Nothing left to show';
}

/**
 * A soft card with a band of first light along its top. Its lines arrive one
 * by one; Undo strikes one through where it stands; Got it folds the card away.
 */
export function MorningDigest({
  title = 'While you slept',
  line,
  items,
  onUndo,
  busy,
  onDismiss,
  max = 5,
  className,
  ...props
}: MorningDigestProps) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = () => {
    setLeaving(true);
    timer.current = setTimeout(() => onDismiss?.(), LEAVE_MS);
  };
  const shown = items.slice(0, max);
  const more = items.length - shown.length;

  return (
    <section
      className={cx(styles.card, className)}
      aria-label={title}
      data-leaving={leaving || undefined}
      {...props}
    >
      <div className={styles.inner}>
        <span className={styles.dawn} aria-hidden />
        <header className={styles.head}>
          <div className={styles.titles}>
            <h3 className={styles.title}>{title}</h3>
            <p className={styles.line}>{line ?? digestLine(items)}</p>
          </div>
          {onDismiss && (
            <IconButton
              label="Got it"
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
        <ul className={styles.items}>
          {shown.map((item, i) => {
            const Icon = ICONS[item.kind];
            const undone = item.state === 'undone';
            return (
              <li
                key={item.id}
                className={styles.item}
                data-kind={item.kind}
                data-undone={undone || undefined}
                style={{ '--i': i } as CSSProperties}
              >
                <Icon aria-hidden className={styles.icon} />
                <div className={styles.words}>
                  <span className={styles.text}>
                    <span className="nc-visually-hidden">{SAID[item.kind]}: </span>
                    {item.text}
                    {undone && <span className="nc-visually-hidden"> (undone)</span>}
                  </span>
                  {item.was && (
                    <span className={styles.was}>
                      Was: <s>{item.was}</s>
                    </span>
                  )}
                </div>
                {undone ? (
                  <span className={styles.undoneTag}>Undone</span>
                ) : (
                  onUndo && (
                    <Button
                      size="sm"
                      variant="ghost"
                      tone="neutral"
                      loading={busy === item.id}
                      aria-label={`Undo “${item.text}”`}
                      onClick={() => onUndo(item.id)}
                    >
                      Undo
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
        {more > 0 && (
          <footer className={styles.foot}>
            <span className={styles.more}>and {more} more</span>
          </footer>
        )}
      </div>
    </section>
  );
}

import { CalendarClock, ChevronDown, ExternalLink, Mail, Moon, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import styles from './CheckIn.module.css';

/*
 * The check-in (ADR 0107): Conch looks at what's new now and then, and tells
 * you only what a standing order asks to hear about. The card is mostly calm:
 * a pearl that rests while it watches and glints when it has told you
 * something, one line on how it's doing, and what it told you lately, each
 * with Why?.
 */

export type CheckInStateName = 'watching' | 'quiet' | 'resting' | 'needs-you' | 'held' | 'off';

export interface ToldItem {
  id: string;
  source: 'mail' | 'calendar';
  /** What it was, in Conch's words. */
  title: string;
  /** What mattered about it, in a few words. */
  note?: string;
  /** Why you heard about it: “You asked: “Tell me if a flight changes””. */
  why: string;
  /** “12 minutes ago”. */
  when: ReactNode;
  /** Over the day's few: listed without a notification. */
  quiet?: boolean;
  /** Where it is (Gmail, the calendar). */
  href?: string;
}

export interface CheckInCardProps extends Omit<ComponentProps<'section'>, 'children' | 'onToggle'> {
  state: CheckInStateName;
  /** One line on how it's doing: “Watching for 2 things · looked 12 minutes ago”. */
  line?: ReactNode;
  /** The quiet hours, as words or a control to change them. */
  quiet?: ReactNode;
  /** Turn it on or off. */
  onToggle?: (on: boolean) => void;
  /** Look now, whatever the time. */
  onLookNow?: () => void;
  looking?: boolean;
  /** For `needs-you`: one sentence and one button. */
  problem?: { message: string; action?: string; onAction?: () => void };
  told?: ToldItem[];
  /** Put one away from the list. */
  onForget?: (id: string) => void;
  /** How many of `told` show before “Show more”. Default 4. */
  max?: number;
}

const HEADLINES: Record<CheckInStateName, string> = {
  watching: 'Keeping an eye out',
  quiet: 'Quiet hours',
  resting: 'Nothing to watch for yet',
  'needs-you': 'Can’t look right now',
  held: 'Waiting to look',
  off: 'Check-ins are off',
};

function Told({ item, onForget }: { item: ToldItem; onForget?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  const Icon = item.source === 'calendar' ? CalendarClock : Mail;
  return (
    <li className={styles.told} data-quiet={item.quiet || undefined}>
      <Icon aria-hidden className={styles.toldIcon} />
      <div className={styles.toldBody}>
        <div className={styles.toldLine}>
          <span className={styles.toldTitle}>{item.note ?? item.title}</span>
          <span className={styles.when}>{item.when}</span>
        </div>
        {item.note && <span className={styles.toldDetail}>{item.title}</span>}
        <div className={styles.toldActions}>
          <button
            type="button"
            className={styles.why}
            aria-expanded={open}
            aria-controls={whyId}
            onClick={() => setOpen((o) => !o)}
          >
            Why?
            <ChevronDown aria-hidden className={styles.chevron} />
          </button>
          {item.quiet && (
            <span className={styles.quietTag}>Listed here, without a notification</span>
          )}
          {item.href && (
            <a className={styles.open} href={item.href} target="_blank" rel="noreferrer noopener">
              Open
              <ExternalLink aria-hidden />
            </a>
          )}
        </div>
        <div id={whyId} className={styles.whyPanel} data-open={open || undefined} hidden={!open}>
          {item.why}
        </div>
      </div>
      {onForget && (
        <IconButton
          label={`Put away “${item.note ?? item.title}”`}
          size="sm"
          variant="ghost"
          tone="neutral"
          className={styles.forget}
          onClick={() => onForget(item.id)}
        >
          <X />
        </IconButton>
      )}
    </li>
  );
}

/**
 * How the check-in is doing, and what it told you. Its pearl glints once
 * whenever there's something new it told you.
 */
export function CheckInCard({
  state,
  line,
  quiet,
  onToggle,
  onLookNow,
  looking = false,
  problem,
  told = [],
  onForget,
  max = 4,
  className,
  ...props
}: CheckInCardProps) {
  const titleId = useId();
  const [all, setAll] = useState(false);
  const newest = told[0]?.id;
  const seen = useRef(newest);
  const [glint, setGlint] = useState(false);
  useEffect(() => {
    if (!newest || newest === seen.current) return;
    seen.current = newest;
    setGlint(true);
    const timer = setTimeout(() => setGlint(false), 1_200);
    return () => clearTimeout(timer);
  }, [newest]);
  const shown = all ? told : told.slice(0, max);
  const on = state !== 'off';

  return (
    <section
      className={cx(styles.card, className)}
      data-state={state}
      aria-labelledby={titleId}
      {...props}
    >
      <header className={styles.head}>
        <span className={styles.mark}>
          {state === 'quiet' ? (
            <Moon aria-hidden className={styles.moon} />
          ) : (
            <Pearl
              size="sm"
              label={null}
              glint={glint}
              state={looking ? 'thinking' : state === 'needs-you' ? 'attention' : 'idle'}
            />
          )}
        </span>
        <div className={styles.titles}>
          <h3 id={titleId} className={styles.title}>
            {HEADLINES[state]}
          </h3>
          {line && <p className={styles.line}>{line}</p>}
        </div>
        {onToggle && (
          <Switch
            size="sm"
            checked={on}
            aria-label="Check in on things"
            onCheckedChange={(checked) => onToggle(checked)}
          />
        )}
      </header>

      {problem && (
        <div className={styles.problem} role="status">
          <span>{problem.message}</span>
          {problem.action && problem.onAction && (
            <Button size="sm" variant="soft" onClick={problem.onAction}>
              {problem.action}
            </Button>
          )}
        </div>
      )}

      {on && (quiet || onLookNow) && (
        <div className={styles.controls}>
          {quiet && <span className={styles.quiet}>{quiet}</span>}
          {onLookNow && state !== 'resting' && (
            <Button size="sm" variant="ghost" tone="neutral" loading={looking} onClick={onLookNow}>
              Look now
            </Button>
          )}
        </div>
      )}

      {told.length > 0 && (
        <div className={styles.toldBlock}>
          <h4 className={styles.toldHeading}>Told you</h4>
          <ul className={styles.toldList}>
            {shown.map((item) => (
              <Told key={item.id} item={item} {...(onForget && { onForget })} />
            ))}
          </ul>
          {told.length > max && (
            <Button size="sm" variant="ghost" tone="neutral" onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show ${told.length - max} more`}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

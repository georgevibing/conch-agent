import { CircleHelp, ShieldAlert, Sparkles, Undo2 } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Collapsible } from '../../components/Collapsible';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import styles from './Learning.module.css';

/** How one thing learned stands (mirrors `LearnedState` in `@conch/protocol`). */
export type LearnedStateName = 'applied' | 'waiting' | 'kept' | 'undone' | 'dismissed' | 'gone';

/** What Conch noticed in a chat (mirrors `LearningSignal`). */
export type LearningSignalName =
  | 'correction'
  | 'rephrase'
  | 'retry'
  | 'stopped'
  | 'files-undone'
  | 'memory-undone'
  | 'frustration'
  | 'pleased'
  | 'worked-another-way';

export const learningSignalLabels: Record<LearningSignalName, string> = {
  correction: 'You corrected it',
  rephrase: 'You asked again in other words',
  retry: 'You sent it again',
  stopped: 'You stopped a reply',
  'files-undone': 'You undid changes to files',
  'memory-undone': 'You took back a memory',
  frustration: 'It wasn’t going well',
  pleased: 'You said it worked',
  'worked-another-way': 'A command worked another way',
};

/** Where something learned came from: what Why? shows. */
export interface LearnedWhyInfo {
  /** The chat's title. */
  chat?: string;
  /** “Yesterday at 14:02”. */
  when?: ReactNode;
  /** Your words it rests on. */
  quotes?: string[];
  signals?: LearningSignalName[];
  /** The model that read the chat; none when Conch's own code learned it. */
  model?: string;
  /** Why it waits, in a sentence. */
  waits?: string;
  /** Opens the chat it was learned in. */
  onOpenChat?: () => void;
}

export interface LearnedThing {
  id: string;
  /** What Conch knows now (or would, once kept). */
  text: string;
  /** What it replaced. */
  was?: string;
  state: LearnedStateName;
  /** Why it waits, in a sentence. */
  waits?: string;
  why?: LearnedWhyInfo;
}

/** Why? — where something learned came from, in a small panel. */
export function LearnedWhy({ why, label = 'Why?' }: { why: LearnedWhyInfo; label?: string }) {
  const titleId = useId();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" tone="neutral" leadingIcon={<CircleHelp />}>
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Content align="end" className={styles.why} aria-labelledby={titleId}>
        <p className={styles.whyTitle} id={titleId}>
          {why.chat ? `Learned in “${why.chat}”` : 'Learned in a chat'}
          {why.when && <span className={styles.whyWhen}> · {why.when}</span>}
        </p>
        {why.quotes && why.quotes.length > 0 && (
          <ul className={styles.quotes} aria-label="What you said">
            {why.quotes.map((q, i) => (
              <li key={i}>
                <q>{q}</q>
              </li>
            ))}
          </ul>
        )}
        {why.signals && why.signals.length > 0 && (
          <ul className={styles.signals} aria-label="What Conch noticed">
            {why.signals.map((s) => (
              <li key={s}>
                <Badge size="sm" tone="neutral" variant="soft">
                  {learningSignalLabels[s]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {why.waits && (
          <p className={styles.waits}>
            <ShieldAlert aria-hidden />
            <span>{why.waits}</span>
          </p>
        )}
        <p className={styles.whyFoot}>
          {why.model ? `Read by ${why.model}.` : 'Noticed by Conch itself, without a model.'}
        </p>
        {why.onOpenChat && (
          <Popover.Close asChild>
            <Button size="sm" variant="soft" onClick={why.onOpenChat}>
              Open the chat
            </Button>
          </Popover.Close>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

const SETTLED: Partial<Record<LearnedStateName, string>> = {
  kept: 'Kept',
  undone: 'Undone · won’t learn this again',
  dismissed: 'Not kept · won’t learn this again',
  gone: 'Forgotten since',
};

interface Answers {
  onUndo?: (id: string) => void;
  onKeep?: (id: string) => void;
  onForget?: (id: string) => void;
  /** The one being answered right now. */
  busy?: string;
}

/** One thing learned, with what it replaced, and its answers. */
function Thing({
  thing,
  meta,
  onUndo,
  onKeep,
  onForget,
  busy,
}: { thing: LearnedThing; meta?: ReactNode } & Answers) {
  const settled = SETTLED[thing.state];
  const working = busy === thing.id;
  return (
    <>
      <div className={styles.row}>
        <p className={styles.text}>
          <span className="nc-visually-hidden">{thing.was ? 'Now: ' : ''}</span>
          {thing.text}
          {thing.was && (
            <span className={styles.was}>
              <span aria-hidden> · was </span>
              <span className="nc-visually-hidden">, it was: </span>
              <del>{thing.was}</del>
            </span>
          )}
        </p>
        <span className={styles.answers}>
          {thing.why && <LearnedWhy why={thing.why} />}
          {thing.state === 'waiting' ? (
            <>
              {onForget && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  disabled={working}
                  onClick={() => onForget(thing.id)}
                >
                  Forget
                </Button>
              )}
              {onKeep && (
                <Button size="sm" variant="soft" loading={working} onClick={() => onKeep(thing.id)}>
                  Keep
                </Button>
              )}
            </>
          ) : (
            (thing.state === 'applied' || thing.state === 'kept') &&
            onUndo && (
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                leadingIcon={<Undo2 />}
                loading={working}
                onClick={() => onUndo(thing.id)}
              >
                Undo
              </Button>
            )
          )}
        </span>
      </div>
      {thing.state === 'waiting' && thing.waits && (
        <p className={styles.waits}>
          <ShieldAlert aria-hidden />
          <span>{thing.waits}</span>
        </p>
      )}
      {(meta || settled) && (
        <p className={styles.foot}>
          {meta && <span>{meta}</span>}
          {meta && settled && <span aria-hidden> · </span>}
          {settled && <span>{settled}</span>}
        </p>
      )}
    </>
  );
}

export interface LearnedLineProps extends Omit<ComponentProps<'div'>, 'children'>, Answers {
  items: LearnedThing[];
  /** Open at first. It opens by itself when something waits for your OK. */
  defaultOpen?: boolean;
}

/**
 * What a chat taught Conch, once it went quiet (ADR 0088): one folded,
 * quiet line at the end of the chat — "Learned 2 things". Open, each thing
 * has Undo and Why?; what waits for your OK has Keep and Forget, and is the
 * only thing here that asks for attention. Never a dialog, never a toast.
 */
export function LearnedLine({
  items,
  defaultOpen,
  onUndo,
  onKeep,
  onForget,
  busy,
  className,
  ...props
}: LearnedLineProps) {
  const waiting = items.filter((i) => i.state === 'waiting').length;
  const [open, setOpen] = useState(defaultOpen ?? waiting > 0);
  const things = items.length === 1 ? '1 thing' : `${items.length} things`;
  return (
    <div
      role="group"
      aria-label="What Conch learned from this chat"
      className={cx(styles.line, className)}
      data-waiting={waiting > 0 || undefined}
      {...props}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className={styles.trigger}>
          <Sparkles aria-hidden className={styles.icon} />
          <span>
            Learned {things}
            {waiting > 0 && (
              <span className={styles.waitingCount}>
                {' '}
                · {waiting === 1 ? '1 waits' : `${waiting} wait`} for your OK
              </span>
            )}
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <ul className={styles.things}>
            {items.map((thing) => (
              <li key={thing.id} className={styles.thing} data-state={thing.state}>
                <Thing
                  thing={thing}
                  {...(onUndo && { onUndo })}
                  {...(onKeep && { onKeep })}
                  {...(onForget && { onForget })}
                  {...(busy && { busy })}
                />
              </li>
            ))}
          </ul>
        </Collapsible.Content>
      </Collapsible>
    </div>
  );
}

export interface LearningTimelineProps extends ComponentProps<'ul'> {
  /** `LearnedEntry` items, newest first. */
  children: ReactNode;
}

/** Everything Conch learned, newest first (ADR 0088): the Memory page's Recent learnings. */
export function LearningTimeline({ className, ...props }: LearningTimelineProps) {
  return (
    <ul aria-label="What Conch learned" className={cx(styles.timeline, className)} {...props} />
  );
}

export interface LearnedEntryProps extends Omit<ComponentProps<'li'>, 'children'>, Answers {
  thing: LearnedThing;
  /** “From “Rename photos” · 2 days ago”. */
  meta?: ReactNode;
}

/** One thing in the record: what it is, what it replaced, where from, and its answers. */
export function LearnedEntry({
  thing,
  meta,
  onUndo,
  onKeep,
  onForget,
  busy,
  className,
  ...props
}: LearnedEntryProps) {
  return (
    <li className={cx(styles.entry, className)} data-state={thing.state} {...props}>
      <Thing
        thing={thing}
        meta={meta}
        {...(onUndo && { onUndo })}
        {...(onKeep && { onKeep })}
        {...(onForget && { onForget })}
        {...(busy && { busy })}
      />
    </li>
  );
}

export interface WeeklyRecapProps extends Omit<ComponentProps<'section'>, 'title'> {
  count: number;
  /** A few of them, newest first. */
  items: string[];
  /** See all: scrolls to Recent learnings. */
  onSeeAll?: () => void;
  /** Got it: the card goes until next week. */
  onDismiss?: () => void;
}

/**
 * The week at a glance (ADR 0088): what Conch learned by itself, in one
 * calm card on the Memory page. No push, no badge; it goes when you've seen it.
 */
export function WeeklyRecap({
  count,
  items,
  onSeeAll,
  onDismiss,
  className,
  ...props
}: WeeklyRecapProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.recap, className)} {...props}>
      <div className={styles.recapHead}>
        <Sparkles aria-hidden className={styles.icon} />
        <p className={styles.recapTitle} id={titleId}>
          This week Conch learned {count === 1 ? 'one thing' : `${count} things`}
        </p>
      </div>
      {items.length > 0 && (
        <ul className={styles.recapItems}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {(onSeeAll || onDismiss) && (
        <div className={styles.recapActions}>
          {onDismiss && (
            <Button size="sm" variant="ghost" tone="neutral" onClick={onDismiss}>
              Got it
            </Button>
          )}
          {onSeeAll && (
            <Button size="sm" variant="soft" onClick={onSeeAll}>
              See all
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export interface NeverThing {
  id: string;
  text: string;
  /** “Taken back 3 days ago”. */
  when?: ReactNode;
}

export interface NeverListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  items: NeverThing[];
  /** Let Conch learn it again. */
  onRemove?: (id: string) => void;
  busy?: string;
}

/** Things Conch won't learn again (ADR 0088): each one you took back, with Remove. */
export function NeverList({ items, onRemove, busy, className, ...props }: NeverListProps) {
  return (
    <ul
      aria-label="Things Conch won’t learn again"
      className={cx(styles.never, className)}
      {...props}
    >
      {items.map((item) => (
        <li key={item.id} className={styles.neverItem}>
          <span className={styles.neverText}>{item.text}</span>
          {item.when && <span className={styles.meta}>{item.when}</span>}
          {onRemove && (
            <Button
              size="sm"
              variant="ghost"
              tone="neutral"
              loading={busy === item.id}
              onClick={() => onRemove(item.id)}
              aria-label={`Let Conch learn “${item.text}” again`}
            >
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

import { CircleHelp, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { cx } from '../../utils/cx';
import styles from './Memory.module.css';

export type MemoryKindName = 'fact' | 'preference' | 'project' | 'person';
export type MemorySourceName = 'user' | 'agent' | 'tidy';

export const memoryKindLabels: Record<MemoryKindName, string> = {
  preference: 'Preference',
  person: 'Person',
  project: 'Project',
  fact: 'Fact',
};

export const memorySourceLabels: Record<MemorySourceName, string> = {
  user: 'You added',
  agent: 'Learned in a chat',
  tidy: 'From a tidy-up',
};

/** A list of memories, each a `MemoryItem`. */
export function MemoryList({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cx(styles.list, className)} {...props} />;
}

export interface MemoryItemProps extends Omit<ComponentProps<'li'>, 'children'> {
  /** What it remembers, or an editor for it. */
  children: ReactNode;
  source: MemorySourceName;
  /** “2 days ago”. */
  time?: ReactNode;
  /** Shown when it's useful (search results mix kinds). */
  kind?: MemoryKindName;
  /** It waits for your OK (ADR 0032): why, in a sentence. */
  waiting?: ReactNode;
  /** Edit, Forget; or Keep, Forget while it waits. */
  actions?: ReactNode;
}

/**
 * One thing Conch remembers. A memory waiting for an OK — learned in a chat
 * that read something from outside, which could have been steering it —
 * says so, warmly coloured, and isn't used until you keep it.
 */
export function MemoryItem({
  children,
  source,
  time,
  kind,
  waiting,
  actions,
  className,
  ...props
}: MemoryItemProps) {
  return (
    <li className={cx(styles.item, className)} data-waiting={waiting ? '' : undefined} {...props}>
      <div className={styles.content}>{children}</div>
      {waiting && (
        <p className={styles.waiting}>
          <ShieldAlert aria-hidden />
          <span>{waiting} Conch won’t use it until you keep it.</span>
        </p>
      )}
      <div className={styles.meta}>
        {kind && (
          <Badge size="sm" tone="neutral" variant="outline">
            {memoryKindLabels[kind]}
          </Badge>
        )}
        <Badge size="sm" tone={source === 'user' ? 'neutral' : 'accent'} variant="soft">
          {memorySourceLabels[source]}
        </Badge>
        {time && <span>{time}</span>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </li>
  );
}

export interface TidyReportProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** “Conch tidied 5 memories”. */
  title: ReactNode;
  /** “Last night at 3:12”. */
  when?: ReactNode;
  /** It couldn't do everything: one sentence. */
  note?: ReactNode;
  /** `TidyChangeItem`s. */
  children?: ReactNode;
}

/**
 * What a memory tidy-up changed (ADR 0032), as a card: every change shown,
 * each with Keep and Undo. Nothing it does is silent.
 */
export function TidyReport({ title, when, note, children, className, ...props }: TidyReportProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.report, className)} {...props}>
      <div className={styles.reportHead}>
        <Sparkles aria-hidden className={styles.reportIcon} />
        <div>
          <p className={styles.reportTitle} id={titleId}>
            {title}
          </p>
          {when && <p className={styles.reportWhen}>{when}</p>}
          {note && <p className={styles.reportNote}>{note}</p>}
        </div>
      </div>
      {children && <ul className={styles.changes}>{children}</ul>}
    </section>
  );
}

export type TidyChangeKind = 'merged' | 'updated' | 'added';
export type TidyChangeState = 'applied' | 'pending' | 'kept' | 'undone' | 'dismissed';

const KIND_LABELS: Record<TidyChangeKind, string> = {
  merged: 'Merged',
  updated: 'Updated',
  added: 'Learned',
};

const STATE_LABELS: Partial<Record<TidyChangeState, string>> = {
  kept: 'Kept',
  undone: 'Undone',
  dismissed: 'Not kept',
};

export interface TidyChangeItemProps extends Omit<ComponentProps<'li'>, 'children'> {
  kind: TidyChangeKind;
  /** What the memories said before. */
  before: string[];
  /** What it says now (or would, once kept). */
  after?: string;
  /** Why, in plain words: “You said you moved to Lisbon.” */
  why?: ReactNode;
  state: TidyChangeState;
  /** It came from a chat that read something untrusted: why it waits. */
  untrusted?: ReactNode;
  /** Keep and Undo (or Keep and Don’t keep, while it waits). */
  actions?: ReactNode;
}

/** One change in a tidy-up, as a small diff: what went, what came, why. */
export function TidyChangeItem({
  kind,
  before,
  after,
  why,
  state,
  untrusted,
  actions,
  className,
  ...props
}: TidyChangeItemProps) {
  const settled = STATE_LABELS[state];
  return (
    <li className={cx(styles.change, className)} data-state={state} {...props}>
      <div className={styles.changeHead}>
        <Badge size="sm" tone={kind === 'added' ? 'success' : 'accent'} variant="soft">
          {KIND_LABELS[kind]}
        </Badge>
        {state === 'pending' && (
          <Badge size="sm" tone="warning" variant="soft">
            Waiting for your OK
          </Badge>
        )}
      </div>
      <ul className={styles.diff} aria-label="What changed">
        {before.map((text, i) => (
          <li key={`b${i}`} className={styles.removed}>
            <span className={styles.sign} aria-hidden>
              −
            </span>
            <span className={styles.text}>
              <span className="nc-visually-hidden">Was: </span>
              {text}
            </span>
          </li>
        ))}
        {after && (
          <li className={styles.added}>
            <span className={styles.sign} aria-hidden>
              +
            </span>
            <span className={styles.text}>
              {before.length > 0 && <span className="nc-visually-hidden">Now: </span>}
              {after}
            </span>
          </li>
        )}
      </ul>
      {why && (
        <p className={styles.why}>
          <CircleHelp aria-hidden />
          <span>{why}</span>
        </p>
      )}
      {untrusted && (
        <p className={styles.waiting}>
          <ShieldAlert aria-hidden />
          <span>{untrusted} Keep it only if it’s right.</span>
        </p>
      )}
      {(settled || actions) && (
        <div className={styles.changeFoot}>
          {settled ? <span className={styles.state}>{settled}</span> : actions}
        </div>
      )}
    </li>
  );
}

export interface SkillSuggestionCardProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** The skill it would be: “Weekly summary”. */
  title: string;
  /** In how many chats you asked. */
  times: number;
  /** A few of the times, in your words. */
  examples: string[];
  /** Look at the draft · Not now · Don’t suggest this. */
  actions?: ReactNode;
}

/**
 * Something you keep asking for, offered as a skill (ADR 0032). Only an
 * offer: the draft opens for you to read and change, and nothing is saved
 * or turned on until you do.
 */
export function SkillSuggestionCard({
  title,
  times,
  examples,
  actions,
  className,
  ...props
}: SkillSuggestionCardProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.suggestion, className)} {...props}>
      <div className={styles.suggestionHead}>
        <Lightbulb aria-hidden className={styles.reportIcon} />
        <p className={styles.suggestionTitle} id={titleId}>
          You’ve asked for this in {times} chats. Save “{title}” as a skill?
        </p>
      </div>
      {examples.length > 0 && (
        <ul className={styles.examples} aria-label="What you asked">
          {examples.map((e, i) => (
            <li key={i} title={e}>
              {e}
            </li>
          ))}
        </ul>
      )}
      {actions && <div className={styles.suggestionActions}>{actions}</div>}
    </section>
  );
}

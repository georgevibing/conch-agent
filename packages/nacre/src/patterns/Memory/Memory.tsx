import {
  CircleAlert,
  CircleHelp,
  Download,
  Lightbulb,
  Route,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Progress } from '../../components/Progress';
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
  /** In how many chats you asked (something you keep asking for). */
  times: number;
  /** A few of the times, in your words. */
  examples: string[];
  /**
   * Learned from how work went in one chat (ADR 0058), not from asking
   * again and again: the chat's title, and how many steps it took.
   */
  fromChat?: { title: string; steps?: number };
  /**
   * Learned in a chat that read something from outside (ADR 0028), in a
   * sentence: “Learned in a chat that read news.example.”
   */
  untrusted?: string;
  /** Look at the draft · Not now · Don’t suggest this. */
  actions?: ReactNode;
}

/**
 * Something that could be a skill, offered (ADR 0032, ADR 0058): what you
 * keep asking for, or how a piece of work went well in one chat. Only an
 * offer: the draft opens for you to read and change, and nothing is saved
 * or turned on until you do.
 */
export function SkillSuggestionCard({
  title,
  times,
  examples,
  fromChat,
  untrusted,
  actions,
  className,
  ...props
}: SkillSuggestionCardProps) {
  const titleId = useId();
  const Icon = fromChat ? Route : Lightbulb;
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.suggestion, className)}
      data-from={fromChat ? 'work' : 'habit'}
      {...props}
    >
      <div className={styles.suggestionHead}>
        <Icon aria-hidden className={styles.reportIcon} />
        <div className={styles.suggestionWords}>
          <p className={styles.suggestionTitle} id={titleId}>
            {fromChat
              ? `From your chat “${fromChat.title}”. Save how it was done as “${title}”?`
              : `You’ve asked for this in ${times} chats. Save “${title}” as a skill?`}
          </p>
          {fromChat?.steps !== undefined && (
            <p className={styles.reportNote}>
              It took {fromChat.steps} steps and worked. The draft keeps what worked and leaves out
              the rest.
            </p>
          )}
        </div>
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
      {untrusted && (
        <p className={cx(styles.waiting, styles.suggestionNote)}>
          <ShieldAlert aria-hidden />
          <span>{untrusted} Read the steps before you save it.</span>
        </p>
      )}
      {actions && <div className={styles.suggestionActions}>{actions}</div>}
    </section>
  );
}

export type MeaningSearchState = 'offer' | 'getting' | 'indexing' | 'meaning' | 'words' | 'problem';

export interface MeaningSearchProps extends Omit<ComponentProps<'section'>, 'title'> {
  state: MeaningSearchState;
  /** The model that gives meaning: “all-MiniLM-L6-v2”. */
  model?: string;
  /** Whose it is: Conch's own, or one in Ollama. */
  source?: 'built-in' | 'ollama';
  /** How big the download is, in words: “23 MB”. */
  size?: string;
  /** It matches across many languages. */
  multilingual?: boolean;
  /** Getting it: how far, 0–100. */
  progress?: number;
  /** Indexing: how many memories are done, of how many. */
  indexed?: number;
  total?: number;
  /** What went wrong, in a sentence (with `words`: why there's no meaning here). */
  problem?: ReactNode;
  /** Get it, or Try again. */
  action?: ReactNode;
}

const count = new Intl.NumberFormat();

/**
 * How memory search works, and the one thing that would make it better
 * (ADR 0041). Before anything is downloaded, search matches words,
 * spellings and a few everyday ideas; Conch's own small model, fetched once
 * when you say so, lets it understand meaning. The offer says how big it is
 * and that it stays on this computer; then progress, then a quiet line.
 */
export function MeaningSearch({
  state,
  model,
  source,
  size,
  multilingual,
  progress,
  indexed = 0,
  total = 0,
  problem,
  action,
  className,
  ...props
}: MeaningSearchProps) {
  const titleId = useId();
  if (state === 'meaning' || state === 'words')
    return (
      <section
        aria-labelledby={titleId}
        className={cx(styles.meaningLine, className)}
        data-state={state}
        {...props}
      >
        <p id={titleId}>
          {state === 'meaning'
            ? `Search understands meaning, with ${model ?? 'a model'} ${source === 'ollama' ? 'in Ollama on' : 'on'} this computer — nothing leaves it.`
            : 'Search matches words, spellings and a few everyday ideas, typos forgiven.'}
        </p>
        {state === 'words' && problem && <p>{problem}</p>}
      </section>
    );
  const Icon = state === 'problem' ? CircleAlert : state === 'offer' ? Sparkles : Download;
  const title = {
    offer: 'Let search understand what you mean',
    getting: 'Getting the model for meaning…',
    indexing: 'Making your memories searchable by meaning…',
    problem: 'Couldn’t get the model for meaning',
  }[state];
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.meaning, className)}
      data-state={state}
      {...props}
    >
      <div className={styles.meaningHead}>
        <Icon aria-hidden className={styles.meaningIcon} />
        <div className={styles.meaningBody}>
          <p className={styles.meaningTitle} id={titleId} aria-live="polite">
            {title}
          </p>
          {state === 'offer' && (
            <p className={styles.meaningText}>
              Search matches words and spellings now. A small model
              {size ? ` (${size}, downloaded once)` : ''} would let it understand meaning:
              “anniversary” would find your wedding
              {multilingual ? ', in any of 50 languages' : ''}. It runs on this computer, even
              offline, and nothing you’ve told Conch leaves it.
            </p>
          )}
          {state === 'getting' && (
            <Progress
              size="sm"
              value={progress ?? null}
              label="Downloaded"
              showValue={progress !== undefined}
            />
          )}
          {state === 'getting' && (
            <p className={styles.meaningText}>You can keep using Conch while it downloads.</p>
          )}
          {state === 'indexing' && (
            <Progress
              size="sm"
              value={indexed}
              max={Math.max(total, 1)}
              label="Memories ready"
              showValue={() => `${count.format(indexed)} of ${count.format(total)}`}
            />
          )}
          {state === 'problem' && problem && <p className={styles.meaningText}>{problem}</p>}
          {state === 'problem' && (
            <p className={styles.meaningText}>
              Search still matches words and spellings in the meantime.
            </p>
          )}
        </div>
      </div>
      {action && <div className={styles.meaningActions}>{action}</div>}
    </section>
  );
}

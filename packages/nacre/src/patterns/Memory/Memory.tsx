import { Brain, Lightbulb, Route, ShieldAlert, ShieldX } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Memory.module.css';

/**
 * What Conch knows about you (ADR 0032). The page itself is in `Knows.tsx`;
 * here are the words every part shares, the question a held memory asks
 * (ADR 0087) and the skill a habit suggests (ADR 0058).
 */
export type MemoryKindName = 'fact' | 'preference' | 'project' | 'person';
export type MemorySourceName = 'user' | 'agent' | 'tidy';

export const memorySourceLabels: Record<MemorySourceName, string> = {
  user: 'You added',
  agent: 'Learned in a chat',
  tidy: 'From a tidy-up',
};

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

export interface MemoryCheckProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'children' | 'content'
> {
  /** What it wants to remember, as it would be kept. */
  content: ReactNode;
  /** Why it looks off: a sentence or two in Conch's own words, never a page's. */
  reasons: string[];
  /** Where it came from: “news.example, a page this chat read”. */
  from?: string;
  /** Refused (a secret, hidden characters): it takes Remember anyway. */
  refused?: boolean;
  /** Takes the content's place while you edit it (Edit first). */
  editor?: ReactNode;
  /** Remember it · Don’t remember · Edit first. */
  actions?: ReactNode;
  /** You answered: it folds to a quiet line. */
  settled?: 'kept' | 'dismissed';
}

/**
 * A memory the memory check held (ADR 0087), in the chat. It wasn't saved and
 * isn't used: it says what it wanted to remember, why that looks off, where
 * it came from, and asks. Calm, not alarming: most of what's held is a page
 * being pushy, and the person decides. A refused one (a password, hidden
 * characters) is a shade firmer and needs Remember anyway. Once answered, it
 * folds to a quiet line, like any memory.
 */
export function MemoryCheck({
  content,
  reasons,
  from,
  refused = false,
  editor,
  actions,
  settled,
  className,
  ...props
}: MemoryCheckProps) {
  const titleId = useId();
  if (settled)
    return (
      // Said aloud once it's answered: focus was on the button that's gone.
      <p className={cx(styles.checkSettled, className)} data-settled={settled} role="status">
        <Brain aria-hidden />
        <span>
          {settled === 'kept' ? 'Remembered: ' : 'Not remembered: '}
          {content}
        </span>
      </p>
    );
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.check, className)}
      data-refused={refused ? '' : undefined}
      {...props}
    >
      <p className={styles.checkHead} id={titleId}>
        {refused ? <ShieldX aria-hidden /> : <ShieldAlert aria-hidden />}
        {refused ? 'I didn’t remember this' : 'Remember this?'}
      </p>
      {editor ?? (
        <p className={styles.checkWhat}>
          <span className="nc-visually-hidden">It wants to remember: </span>
          {content}
        </p>
      )}
      <ul className={styles.checkWhy} aria-label="Why it looks off">
        {reasons.slice(0, 3).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {from && <p className={styles.checkFrom}>From {from}</p>}
      {actions && <div className={styles.checkActions}>{actions}</div>}
    </section>
  );
}

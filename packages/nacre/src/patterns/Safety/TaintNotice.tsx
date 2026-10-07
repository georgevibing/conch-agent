import { ShieldAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { LineGroup } from '../LineGroup';
import styles from './Safety.module.css';

export interface TaintNoticeProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** What it read: "example.com", "things in Gmail", "a message from Ana". */
  read: ReactNode;
  /** The first time in a chat says what changes; later ones only what was read. */
  first?: boolean;
}

/**
 * A quiet line in the chat when it reads something from outside (ADR 0028):
 * nothing's wrong, but from here on, anything that could send what it read
 * somewhere, or change the computer, asks first.
 */
export function TaintNotice({ read, first = true, className, ...props }: TaintNoticeProps) {
  return (
    <p className={cx(styles.notice, className)} {...props}>
      <ShieldAlert aria-hidden />
      <span>
        Read {read}.
        {first && (
          <span className={styles.after}>
            {' '}
            From here on, I’ll check with you before running commands or sending anything.
          </span>
        )}
      </span>
    </p>
  );
}

/** One thing a chat read from outside, as the gateway says it (ADR 0028). */
export interface TaintRead {
  kind: 'web' | 'download' | 'app' | 'person';
  /** "example.com", "Gmail", "your chat “Trip plans”", "Ana on Telegram". */
  label: string;
}

const GENERIC_DOWNLOAD = 'something downloaded';

/** Each read once: a page and a download from the same site are the same place. */
export function distinctReads(reads: readonly TaintRead[]): TaintRead[] {
  const seen = new Map<string, TaintRead>();
  for (const read of reads) {
    const site = read.kind === 'web' || read.kind === 'download';
    const key = `${site ? 'site' : read.kind}:${read.label.trim().toLowerCase()}`;
    const had = seen.get(key);
    // The page itself says it plainer than "something downloaded from" it.
    if (!had || (had.kind === 'download' && read.kind === 'web')) seen.set(key, read);
  }
  return [...seen.values()];
}

/** One read, in words: "example.com", "something downloaded from x.org", "things in Gmail". */
export function readWords({ kind, label }: TaintRead): string {
  if (kind === 'download')
    return label === GENERIC_DOWNLOAD ? label : `something downloaded from ${label}`;
  if (kind === 'app') return `things in ${label}`;
  if (kind === 'person') return `a message from ${label}`;
  return label;
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

function list(parts: string[]): string {
  return parts.length < 2
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** All of them in a few words: "7 sites, 2 of your chats and things in Gmail". */
export function taintSummary(reads: readonly TaintRead[]): string {
  const distinct = distinctReads(reads);
  const [only] = distinct;
  if (only && distinct.length === 1) return readWords(only);
  const sites = distinct.filter((r) => r.kind === 'web' || r.kind === 'download');
  const chats = distinct.filter((r) => r.kind === 'app' && /^your chat\b/i.test(r.label));
  const apps = distinct.filter((r) => r.kind === 'app' && !chats.includes(r));
  const people = distinct.filter((r) => r.kind === 'person');
  const parts: string[] = [];
  if (sites.length)
    parts.push(sites[0] && sites.length === 1 ? readWords(sites[0]) : `${sites.length} sites`);
  if (chats.length) parts.push(count(chats.length, 'one of your chats', 'of your chats'));
  if (apps.length)
    parts.push(
      apps.length <= 2
        ? `things in ${list(apps.map((a) => a.label))}`
        : `${apps.length} of your apps`,
    );
  if (people.length)
    parts.push(
      people[0] && people.length === 1
        ? readWords(people[0])
        : `${people.length} messages from other people`,
    );
  return list(parts);
}

export interface TaintReadsProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What it read, in order: said as one line that opens to each. */
  reads: readonly TaintRead[];
  /** The first time in a chat says what changes; later ones only what was read. */
  first?: boolean;
  /**
   * Where these came from: read here, carried over from the chat a task came
   * from (`chat`), or brought back by a task (`task`).
   */
  from?: 'chat' | 'task';
}

const CHECKS = 'check with you before running commands or sending anything';

/**
 * What a chat read from outside, said once however much it was (ADR 0028): one
 * read reads as a line, several as a summary that opens to each.
 */
export function TaintReads({ reads, first = true, from, className, ...props }: TaintReadsProps) {
  const distinct = distinctReads(reads);
  const summary = taintSummary(distinct);
  // Carried over, the care comes with it: said whenever, not only the first time.
  const said = first || from === 'chat';
  // One sentence: what was read, then (quieter) what that changes.
  const [lead, after] =
    from === 'chat'
      ? [`The chat it came from had read ${summary}`, `, so I’ll ${CHECKS}.`]
      : [
          from === 'task' ? `Its task read ${summary}` : `Read ${summary}`,
          `. From here on, I’ll ${CHECKS}.`,
        ];
  const sentence = (
    <>
      {said ? lead : `${lead}.`}
      {said && <span className={styles.after}>{after}</span>}
    </>
  );
  // One read is one line: nothing to open.
  if (distinct.length < 2)
    return (
      <div className={className} {...props}>
        <p className={styles.notice}>
          <ShieldAlert aria-hidden />
          <span>{sentence}</span>
        </p>
      </div>
    );
  return (
    <LineGroup
      className={className}
      icon={<ShieldAlert aria-hidden />}
      summary={sentence}
      label={from === 'task' ? 'What its task read' : 'What it read'}
      items={distinct.map(readWords)}
      footnote={
        said
          ? 'Something read from outside could try to steer me, so I ask before acting on it.'
          : `Because of what it read, I’ll ${CHECKS}.`
      }
      {...props}
    />
  );
}

export interface GuardNoteProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** Why it's asking: "This chat read example.com, which could be trying to steer me…". */
  children: ReactNode;
}

/** On a permission card: why it's asking even though it wouldn't usually. */
export function GuardNote({ children, className, ...props }: GuardNoteProps) {
  return (
    <p className={cx(styles.guard, className)} {...props}>
      <ShieldAlert aria-hidden />
      <span>{children}</span>
    </p>
  );
}

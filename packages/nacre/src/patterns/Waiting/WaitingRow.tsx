import { ArrowUpRight, RefreshCw, Square } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { storyDuration, useNow } from '../Story/format';
import { StoryMark, type StoryStatus } from '../Story/Story';
import type { StoryFamily } from '../Story/types';
import { Odometer } from '../ThinkingIndicator/Odometer';
import { formatElapsed } from '../ThinkingIndicator/ThinkingIndicator';
import styles from './WaitingRow.module.css';

/** What a wait watches. */
export type WaitingKind = 'process' | 'ci' | 'url' | 'time';
/** Where it is: watching, or how it ended. */
export type WaitingState = 'watching' | 'done' | 'timed-out' | 'stopped' | 'failed';
/** One part of what's watched (a CI job): a dot that fills in. */
export type WaitingPartState = 'waiting' | 'running' | 'passed' | 'failed' | 'skipped';

export interface WaitingPart {
  name: string;
  state: WaitingPartState;
}

export interface WaitingRowProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  kind: WaitingKind;
  /** What it waits for, in a few words: "CI for conch #482". */
  title: string;
  state: WaitingState;
  /** How it went, once over: green, red, or neither. */
  tone?: 'good' | 'bad' | 'neutral';
  /** Now: "4 of 7 checks done". Over: "CI finished: 2 failed — e2e, server unit". */
  status: string;
  parts?: WaitingPart[];
  startedAt: number;
  endedAt?: number;
  /** When Conch looks next (a clocked wait); unset, it's watched live. */
  nextCheckAt?: number;
  /** Where to see it yourself. */
  url?: string;
  /** The chat carries on by itself when it ends (it isn't holding a turn). */
  wakes?: boolean;
  /** You'll be told when it ends. */
  tell?: boolean;
  onCheck?: () => void;
  onStop?: () => void;
  /** Arriving in a live chat: the end is announced once. */
  arriving?: boolean;
}

const FAMILY: Record<WaitingKind, StoryFamily> = {
  ci: 'verify',
  process: 'run',
  url: 'research',
  time: 'plan',
};

const PART_WORD: Record<WaitingPartState, string> = {
  waiting: 'waiting',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
};

/** The headline, in the present while it watches and the past once it's over. */
export function waitingHeadline(kind: WaitingKind, state: WaitingState, title: string): string {
  if (state === 'watching')
    return kind === 'time' ? `Waiting until ${title}` : `Waiting for ${title}`;
  if (state === 'done') return kind === 'time' ? `Waited until ${title}` : `Waited for ${title}`;
  if (state === 'timed-out') return `Gave up waiting for ${title}`;
  if (state === 'stopped') return `Stopped waiting ${kind === 'time' ? 'until' : 'for'} ${title}`;
  return `Couldn’t watch ${title}`;
}

function mark(state: WaitingState, tone: WaitingRowProps['tone']): StoryStatus {
  if (state === 'watching') return 'running';
  if (state === 'stopped') return 'declined';
  if (state === 'done') return tone === 'bad' ? 'failed' : 'done';
  return 'failed';
}

/** "in 40 s", "now": when the next look is. */
function nextIn(at: number, now: number): string {
  const s = Math.round((at - now) / 1000);
  if (s <= 1) return 'looking now';
  if (s < 60) return `next look in ${s} s`;
  return `next look in ${Math.round(s / 60)} min`;
}

/**
 * Something Conch waits for on the assistant's behalf (ADR 0125), in one
 * calm row: what it waits for, how it stands now (a CI run's jobs as small
 * dots that fill in), how long it's been, when Conch looks next, and Check now
 * and Stop waiting. No model is called while it waits. Once over it says how
 * it went in words, and the chat carries on from there.
 */
export function WaitingRow({
  kind,
  title,
  state,
  tone,
  status,
  parts = [],
  startedAt,
  endedAt,
  nextCheckAt,
  url,
  wakes = false,
  tell = false,
  onCheck,
  onStop,
  arriving = false,
  className,
  ...props
}: WaitingRowProps) {
  const watching = state === 'watching';
  const now = useNow(watching);
  const elapsed = (watching ? now : (endedAt ?? now)) - startedAt;
  const headline = waitingHeadline(kind, state, title);
  const failed = parts.filter((p) => p.state === 'failed').length;

  // The end is said once, where a screen reader hears it: the live region fills when it ends.
  const said = arriving && !watching ? `${headline}. ${status}` : '';

  const note = watching
    ? [
        nextCheckAt !== undefined ? nextIn(nextCheckAt, now) : 'watching live',
        wakes ? 'you can keep chatting' : '',
        tell ? 'you’ll be told' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <div
      className={cx(styles.root, className)}
      data-state={state}
      data-tone={tone}
      data-arriving={arriving || undefined}
      {...props}
    >
      <div className={styles.header}>
        <StoryMark family={FAMILY[kind]} status={mark(state, tone)} arriving={arriving} />
        <span className={styles.title}>
          <span className={styles.headline}>{headline}</span>
        </span>
        <span className={styles.meta} aria-hidden>
          {watching ? (
            elapsed >= 1000 && <Odometer value={formatElapsed(elapsed).replace(' ', ' ')} />
          ) : (
            <span>{storyDuration(Math.max(0, elapsed))}</span>
          )}
        </span>
        <span className="nc-visually-hidden">
          ,{' '}
          {watching
            ? `waiting for ${storyDuration(Math.max(0, elapsed))}`
            : `took ${storyDuration(Math.max(0, elapsed))}`}
        </span>
      </div>

      <div className={styles.body}>
        {parts.length > 0 && (
          <ul
            className={styles.parts}
            aria-label={`${parts.length} ${kind === 'ci' ? 'checks' : 'parts'}${failed ? `, ${failed} failed` : ''}`}
          >
            {parts.map((part) => (
              <li
                key={part.name}
                className={styles.part}
                data-state={part.state}
                title={`${part.name}: ${PART_WORD[part.state]}`}
              >
                <span className="nc-visually-hidden">
                  {part.name}, {PART_WORD[part.state]}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.status} data-tone={!watching ? tone : undefined}>
          {status}
        </p>
        {(note || url || (watching && (onCheck || onStop))) && (
          <div className={styles.foot}>
            {note && <span className={styles.note}>{note}</span>}
            <span className={styles.actions}>
              {url && (
                <a className={styles.link} href={url} target="_blank" rel="noreferrer noopener">
                  {kind === 'ci' ? 'Open on GitHub' : 'Open'}
                  <ArrowUpRight aria-hidden />
                </a>
              )}
              {watching && onCheck && nextCheckAt !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  className={styles.action}
                  leadingIcon={<RefreshCw aria-hidden />}
                  onClick={onCheck}
                >
                  Check now
                </Button>
              )}
              {watching && onStop && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  className={styles.action}
                  leadingIcon={<Square aria-hidden className={styles.stopIcon} />}
                  aria-label="Stop waiting"
                  onClick={onStop}
                >
                  Stop
                </Button>
              )}
            </span>
          </div>
        )}
      </div>
      <span className="nc-visually-hidden" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

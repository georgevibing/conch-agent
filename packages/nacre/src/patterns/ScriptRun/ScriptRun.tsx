import { ChevronRight, CornerUpLeft, CornerUpRight, Square } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { CodeBlock } from '../CodeBlock';
import { LiveLine } from '../LiveLine/LiveLine';
import { FamilyGlyph } from '../Story/FamilyGlyph';
import { storyDuration, useNow } from '../Story/format';
import { MorphText } from '../Story/MorphText';
import { StoryMark, type StoryStatus } from '../Story/Story';
import type { StoryFamily } from '../Story/types';
import { Odometer } from '../ThinkingIndicator/Odometer';
import { formatElapsed } from '../ThinkingIndicator/ThinkingIndicator';
import styles from './ScriptRun.module.css';

/** Where a run is. `stopped`: you pressed Stop, or the turn ended under it. */
export type ScriptRunState = 'running' | 'done' | 'failed' | 'stopped';

/** One tool's calls in the run, counted, in words: "Read an email" ×120. */
export interface ScriptRunTally {
  tool: string;
  /** What one call does, in plain words: "Read an email". */
  label: string;
  family: StoryFamily;
  calls: number;
  running?: number;
  failed?: number;
  /** Calls you said no to, or a rule stopped. */
  declined?: number;
}

/** One call the script made. */
export interface ScriptRunCall {
  id: string;
  /** Which call of the run it is, from 1. */
  step: number;
  tool: string;
  /** It in a few words: the address, the query, the file. */
  summary?: string;
  status: 'running' | 'success' | 'error' | 'declined';
  /** What it was given (JSON) and what it answered, as kept. */
  input: string;
  output?: string;
  durationMs?: number;
}

/** A question the run asked you, at one of its calls. */
export interface ScriptRunAsk {
  id: string;
  step: number;
  /** What it asked about: "Send an email to anna@example.com". */
  text: string;
  answer: 'waiting' | 'allowed' | 'always' | 'declined' | 'expired';
}

export interface ScriptRunProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  /** What it's for, in the assistant's words: "Tag the invoices among my emails". */
  title: string;
  /** What it came to, once it's over (the script's last note): "Tagged 47 invoices among 300 emails". */
  headline?: string;
  state: ScriptRunState;
  /** While it runs: its latest note, or the call at hand. */
  live?: string;
  /** How far it says it is: `progress(done, total, label)`. */
  progress?: { done: number; total?: number; label?: string };
  /** Its calls by tool, most first. */
  tally: ScriptRunTally[];
  /** Every call it made, in order (or the latest of them). */
  calls?: ScriptRunCall[];
  /** How many calls in all, when `calls` holds only some of them. */
  callCount?: number;
  /** The script itself. */
  script: string;
  /** What went back to the assistant: what it returned and logged. */
  result?: string;
  /** Why it failed, in a sentence. */
  error?: string;
  /** The questions it asked along the way. */
  asks?: ScriptRunAsk[];
  /** The question waiting now, drawn right under the line: the run waits for it. */
  approval?: ReactNode;
  startedAt?: number;
  /** How long it worked, once it's over (waiting for you not counted). */
  durationMs?: number;
  /** What it changed that can be put back, all at once. */
  changes?: { count: number; undone?: boolean; onUndo?: () => void; onRedo?: () => void };
  /** Stop the run (while it runs). */
  onStop?: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** It's arriving in a live turn: changes play, start and end are announced. */
  arriving?: boolean;
}

const MARK: Record<ScriptRunState, StoryStatus> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  stopped: 'declined',
};

const SHOWN = 25;

const count = (n: number) => n.toLocaleString('en');
const calls = (n: number) => `${count(n)} tool call${n === 1 ? '' : 's'}`;

function Clock({
  state,
  startedAt,
  durationMs,
}: Pick<ScriptRunProps, 'state' | 'startedAt' | 'durationMs'>) {
  const running = state === 'running';
  const now = useNow(running && startedAt !== undefined);
  if (running && startedAt !== undefined) {
    const elapsed = now - startedAt;
    if (elapsed < 1000) return null;
    return <Odometer value={formatElapsed(elapsed).replace(' ', ' ')} />;
  }
  return !running && durationMs !== undefined ? <span>{storyDuration(durationMs)}</span> : null;
}

const SAID: Record<ScriptRunCall['status'], string> = {
  running: 'running',
  success: 'done',
  error: 'didn’t work',
  declined: 'not allowed',
};

/** One call: a dot, which call it was, what it was about, how long; open for what went in and out. */
function CallRow({ call }: { call: ScriptRunCall }) {
  return (
    <Collapsible.Root asChild>
      <li className={styles.call} data-status={call.status}>
        <Collapsible.Trigger className={styles.callHead}>
          <span className={styles.callDot} aria-hidden />
          <span className={styles.callStep}>#{count(call.step)}</span>
          <span className={styles.callSummary}>{call.summary ?? call.tool}</span>
          <span className="nc-visually-hidden">, {SAID[call.status]}</span>
          {call.durationMs !== undefined && (
            <span className={styles.callTime}>{storyDuration(call.durationMs)}</span>
          )}
          <ChevronRight aria-hidden className={styles.callChevron} />
        </Collapsible.Trigger>
        <Collapsible.Content className={styles.callBody}>
          <span className={styles.ioLabel}>Input</span>
          <pre className={styles.io}>{call.input}</pre>
          {call.output !== undefined && (
            <>
              <span className={styles.ioLabel}>
                {call.status === 'success' ? 'Output' : 'What it said'}
              </span>
              <pre className={styles.io}>{call.output}</pre>
            </>
          )}
        </Collapsible.Content>
      </li>
    </Collapsible.Root>
  );
}

/** One tool's calls: a row with its count, opening to each call. */
function Group({ tally, calls: all }: { tally: ScriptRunTally; calls: ScriptRunCall[] }) {
  const [everything, setEverything] = useState(false);
  const shown = everything ? all : all.slice(-SHOWN);
  const hidden = all.length - shown.length;
  const quiet = [
    tally.running ? `${count(tally.running)} running` : '',
    tally.failed ? `${count(tally.failed)} didn’t work` : '',
    tally.declined ? `${count(tally.declined)} not allowed` : '',
  ].filter(Boolean);
  return (
    <Collapsible.Root asChild disabled={!all.length}>
      <li className={styles.group} data-failed={tally.failed ? true : undefined}>
        <Collapsible.Trigger className={styles.groupHead}>
          <FamilyGlyph
            family={tally.family}
            active={Boolean(tally.running)}
            className={styles.groupGlyph}
          />
          <span className={styles.groupLabel}>{tally.label}</span>
          <span className={styles.groupCount}>×{count(tally.calls)}</span>
          {quiet.length > 0 && <span className={styles.groupQuiet}>{quiet.join(' · ')}</span>}
          <span className={styles.groupTool}>{tally.tool}</span>
          {all.length > 0 && <ChevronRight aria-hidden className={styles.groupChevron} />}
        </Collapsible.Trigger>
        {all.length > 0 && (
          <Collapsible.Content className={styles.groupBody}>
            {hidden > 0 && (
              <p className={styles.hidden}>
                The last {count(shown.length)} of {count(all.length)}.{' '}
                <button type="button" className={styles.link} onClick={() => setEverything(true)}>
                  Show all
                </button>
              </p>
            )}
            <ol className={styles.calls}>
              {shown.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </ol>
          </Collapsible.Content>
        )}
      </li>
    </Collapsible.Root>
  );
}

const ANSWER: Record<ScriptRunAsk['answer'], string> = {
  waiting: 'Waiting for you',
  allowed: 'You allowed it',
  always: 'Always allowed',
  declined: 'You said no',
  expired: 'No answer, so not done',
};

/**
 * A script the assistant wrote to call its tools (ADR 0119), told as one
 * story: what it's for, how far it is and how many calls of each kind it has
 * made while it runs, what it came to once it's over. Open it for the script
 * itself, every call it made grouped by tool (each opening to its input and
 * output), the questions it asked, and what it returned. A question it waits
 * on sits right under the line; Undo puts back everything it changed at once.
 */
export function ScriptRun({
  title,
  headline,
  state,
  live,
  progress,
  tally,
  calls: made = [],
  callCount,
  script,
  result,
  error,
  asks = [],
  approval,
  startedAt,
  durationMs,
  changes,
  onStop,
  open,
  defaultOpen,
  onOpenChange,
  arriving = false,
  className,
  ...props
}: ScriptRunProps) {
  const running = state === 'running';
  const total = callCount ?? tally.reduce((n, t) => n + t.calls, 0);
  const progressId = useId();
  const shownHeadline = !running && headline ? headline : title;
  const fraction =
    progress?.total && progress.total > 0 ? Math.min(1, progress.done / progress.total) : undefined;
  const far =
    progress && progress.total
      ? `${count(Math.round(progress.done))} of ${count(progress.total)}${progress.label ? ` ${progress.label}` : ''}`
      : progress
        ? `${count(Math.round(progress.done))}${progress.label ? ` ${progress.label}` : ''}`
        : undefined;
  const outcome = running
    ? (far ?? (total ? calls(total) : undefined))
    : state === 'stopped'
      ? `Stopped after ${calls(total)}`
      : state === 'failed'
        ? 'Didn’t finish'
        : calls(total);
  const waiting = asks.some((a) => a.answer === 'waiting') || approval != null;

  // Said once when it starts and once when it ends.
  const [said, setSaid] = useState('');
  const announced = useRef<ScriptRunState | undefined>(undefined);
  useEffect(() => {
    if (!arriving || announced.current === state) return;
    announced.current = state;
    setSaid(
      state === 'running'
        ? `Started a script: ${title}`
        : state === 'done'
          ? `Script done: ${shownHeadline}, ${calls(total)}`
          : state === 'stopped'
            ? `Script stopped: ${title}`
            : `Script didn’t finish: ${title}`,
    );
  }, [arriving, state, title, shownHeadline, total]);

  const byTool = new Map<string, ScriptRunCall[]>();
  for (const call of made) byTool.set(call.tool, [...(byTool.get(call.tool) ?? []), call]);

  return (
    <Collapsible.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} asChild>
      <div
        className={cx(styles.root, className)}
        data-state-run={state}
        data-waiting={waiting || undefined}
        data-arriving={arriving || undefined}
        {...props}
      >
        <Collapsible.Trigger className={styles.header} data-lustre="">
          <StoryMark family="run" status={waiting ? 'running' : MARK[state]} arriving={arriving} />
          <span className={styles.title}>
            <MorphText text={shownHeadline} animate={arriving} className={styles.headline} />
            {outcome && (
              <span className={styles.outcome}>
                <span className={styles.dot} aria-hidden>
                  ·
                </span>
                <span>{outcome}</span>
              </span>
            )}
          </span>
          <span className={styles.meta} aria-hidden>
            <span className={styles.kind}>Script</span>
            <Clock state={state} startedAt={startedAt} durationMs={durationMs} />
            <ChevronRight className={styles.chevron} />
          </span>
          <span className="nc-visually-hidden">
            , a script, {calls(total)}
            {running
              ? ', working'
              : state === 'done'
                ? ', done'
                : state === 'stopped'
                  ? ', stopped'
                  : ', didn’t finish'}
            {!running && durationMs !== undefined ? `, took ${storyDuration(durationMs)}` : ''}
          </span>
        </Collapsible.Trigger>

        {running && (
          <div className={styles.live}>
            {fraction !== undefined && (
              <div
                className={styles.bar}
                role="progressbar"
                aria-labelledby={progressId}
                aria-valuemin={0}
                aria-valuemax={progress?.total}
                aria-valuenow={Math.round(progress?.done ?? 0)}
              >
                <span id={progressId} className="nc-visually-hidden">
                  {far}
                </span>
                <span
                  className={styles.fill}
                  style={{ inlineSize: `${(fraction * 100).toFixed(2)}%` }}
                />
              </div>
            )}
            <div className={styles.liveRow}>
              <LiveLine
                text={waiting ? 'Waiting for your answer' : (live ?? 'Working')}
                active={!waiting}
                announce={false}
                className={styles.liveLine}
              />
              {onStop && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="neutral"
                  leadingIcon={<Square aria-hidden className={styles.stopIcon} />}
                  onClick={onStop}
                >
                  Stop
                </Button>
              )}
            </div>
            {tally.length > 0 && (
              <ul className={styles.counters} aria-label="Calls so far">
                {tally.slice(0, 4).map((t) => (
                  <li
                    key={t.tool}
                    className={styles.counter}
                    data-running={t.running ? true : undefined}
                  >
                    <FamilyGlyph
                      family={t.family}
                      active={Boolean(t.running)}
                      className={styles.counterGlyph}
                    />
                    <span className={styles.counterLabel}>{t.label}</span>
                    <span className={styles.counterCount} aria-label={`${count(t.calls)} times`}>
                      ×<Odometer value={count(t.calls)} aria-hidden />
                    </span>
                  </li>
                ))}
                {tally.length > 4 && (
                  <li className={styles.counterMore}>+{count(tally.length - 4)} more kinds</li>
                )}
              </ul>
            )}
          </div>
        )}

        {approval != null && <div className={styles.approval}>{approval}</div>}

        {!running && changes && changes.count > 0 && (
          <div className={styles.undo}>
            {changes.undone ? (
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                leadingIcon={<CornerUpRight aria-hidden />}
                onClick={changes.onRedo}
                disabled={!changes.onRedo}
              >
                Put {changes.count === 1 ? 'it' : `all ${count(changes.count)}`} back again
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                leadingIcon={<CornerUpLeft aria-hidden />}
                onClick={changes.onUndo}
                disabled={!changes.onUndo}
              >
                {changes.count === 1
                  ? 'Undo its change'
                  : `Undo all ${count(changes.count)} changes`}
              </Button>
            )}
          </div>
        )}

        <Collapsible.Content className={styles.content}>
          <div className={styles.panel}>
            {error && !running && <p className={styles.error}>{error}</p>}
            <section className={styles.section} aria-label="The script">
              <CodeBlock code={script} language="javascript" filename="The script" maxLines={14} />
            </section>
            {tally.length > 0 && (
              <section className={styles.section} aria-label="What it called">
                <h4 className={styles.heading}>What it called</h4>
                <ul className={styles.groups}>
                  {tally.map((t) => (
                    <Group key={t.tool} tally={t} calls={byTool.get(t.tool) ?? []} />
                  ))}
                </ul>
              </section>
            )}
            {asks.length > 0 && (
              <section className={styles.section} aria-label="What it asked you">
                <h4 className={styles.heading}>What it asked you</h4>
                <ul className={styles.asks}>
                  {asks.map((ask) => (
                    <li key={ask.id} className={styles.ask} data-answer={ask.answer}>
                      <span className={styles.askStep}>Step {count(ask.step)}</span>
                      <span className={styles.askText}>{ask.text}</span>
                      <span className={styles.askAnswer}>{ANSWER[ask.answer]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result && !running && (
              <section className={styles.section} aria-label="What it returned">
                <h4 className={styles.heading}>What it gave back</h4>
                <pre className={styles.result}>{result}</pre>
              </section>
            )}
          </div>
        </Collapsible.Content>
        <span className="nc-visually-hidden" aria-live="polite">
          {said}
        </span>
      </div>
    </Collapsible.Root>
  );
}

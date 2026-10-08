import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  Brain,
  FileDiff,
  Globe,
  MessageCircle,
  Pause,
  Play,
  Send,
  ShieldQuestion,
  Sparkles,
  User,
} from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { usePrefersReducedMotion } from '../../utils/useMediaQuery';
import { Diff } from '../Diff';
import { FamilyGlyph } from '../Story/FamilyGlyph';
import { storyDuration } from '../Story/format';
import { MorphText } from '../Story/MorphText';
import type { StoryFamily } from '../Story/types';
import styles from './RunReplay.module.css';

/** What a step is. Mirrors `@conch/protocol`'s `RunStepKind`. */
export type ReplayStepKind =
  | 'asked'
  | 'thought'
  | 'said'
  | 'tool'
  | 'approval'
  | 'files'
  | 'browser'
  | 'task'
  | 'made'
  | 'remembered'
  | 'problem';

/** One step on the time axis. Mirrors `RunStep`. */
export interface ReplayStep {
  id: string;
  kind: ReplayStepKind;
  at: number;
  durationMs?: number;
  turn: number;
  family?: StoryFamily;
  title: string;
  detail?: string;
  status?: 'done' | 'failed' | 'declined' | 'waiting';
  anchor?: string;
  peek?: string;
  /** `+`/`-` lines. */
  diff?: string;
  files?: { path: string; kind: 'created' | 'changed' | 'deleted' }[];
  /** A picture of the page after a browser step, as an address the app serves. */
  shot?: string;
  url?: string;
}

/** One turn's tally. Mirrors `RunTurn`. */
export interface ReplayTurn {
  index: number;
  at: number;
  endAt?: number;
  usage?: { inputTokens: number; outputTokens: number };
  cost?: { usd?: number; billing?: string };
}

export interface RunReplayProps extends Omit<ComponentProps<'section'>, 'children'> {
  steps: ReplayStep[];
  turns?: ReplayTurn[];
  /** Who did it, for the lines it wrote: "Pearl". */
  speaker?: string;
  /** Open the chat at this step. Without it, there's no "Show in chat". */
  onJump?: (step: ReplayStep) => void;
  /** Start here (an index into `steps`); the last step by default. */
  initialStep?: number;
  /** The timeline stops short of the whole chat. */
  more?: boolean;
  /** For tests and stories: the replay's pace, per step at most (ms). */
  pace?: number;
}

/** Long waits (you were away) are drawn as this much, with a break: time at work stays readable. */
const GAP_CAP = 20_000;
const GAP_MIN = 600;

/** Where each step sits on the axis, 0 to 1: time at work, long waits folded. */
export function replayPositions(steps: readonly ReplayStep[]): { at: number[]; breaks: number[] } {
  if (steps.length < 2) return { at: steps.map(() => 0), breaks: [] };
  const raw: number[] = [0];
  const breaks: number[] = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const step = steps[i];
    const gap = prev && step ? step.at - (prev.at + (prev.durationMs ?? 0)) : 0;
    const took = Math.min(prev?.durationMs ?? 0, GAP_CAP);
    if (gap > GAP_CAP) breaks.push(i);
    raw.push((raw[i - 1] ?? 0) + Math.max(GAP_MIN, took + Math.min(Math.max(gap, 0), GAP_CAP)));
  }
  const last = steps.at(-1);
  const end = (raw.at(-1) ?? 0) + Math.min(last?.durationMs ?? 0, GAP_CAP);
  const total = Math.max(1, end);
  return { at: raw.map((x) => x / total), breaks: breaks.map((i) => (raw[i] ?? 0) / total) };
}

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

/** What the work came to by this step: time at work, steps, tokens and money, from the turns done by then. */
export function replayTally(
  steps: readonly ReplayStep[],
  turns: readonly ReplayTurn[],
  index: number,
): { duration: number; steps: number; tokens: number; usd: number } {
  const step = steps[index];
  if (!step) return { duration: 0, steps: 0, tokens: 0, usd: 0 };
  const until = step.at + (step.durationMs ?? 0);
  let duration = 0;
  let used = 0;
  let usd = 0;
  for (const turn of turns) {
    if (turn.at > until) continue;
    const end = turn.endAt ?? until;
    duration += Math.max(0, Math.min(end, until) - turn.at);
    // A turn's tokens and money are known once it ended.
    if (turn.endAt !== undefined && turn.endAt <= until + 1) {
      used += (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
      if (turn.cost?.billing !== 'plan') usd += turn.cost?.usd ?? 0;
    }
  }
  return { duration, steps: index + 1, tokens: used, usd };
}

const ICONS: Record<Exclude<ReplayStepKind, 'tool'>, ReactNode> = {
  asked: <User />,
  thought: <Brain />,
  said: <MessageCircle />,
  approval: <ShieldQuestion />,
  files: <FileDiff />,
  browser: <Globe />,
  task: <Send />,
  made: <Sparkles />,
  remembered: <Bookmark />,
  problem: <AlertTriangle />,
};

const STATUS_WORDS: Record<NonNullable<ReplayStep['status']>, string> = {
  done: 'Done',
  failed: 'Didn’t work',
  declined: 'Not done',
  waiting: 'Still going',
};

function Glyph({ step }: { step: ReplayStep }) {
  return (
    <span className={styles.glyph} data-kind={step.kind} data-family={step.family} aria-hidden>
      {step.kind === 'tool' ? <FamilyGlyph family={step.family ?? 'other'} /> : ICONS[step.kind]}
    </span>
  );
}

function lineFor(step: ReplayStep, speaker: string): string {
  if (step.kind === 'asked') return `You: ${step.title}`;
  if (step.kind === 'said') return `${speaker}: ${step.title}`;
  return step.title;
}

/**
 * How it did it: every step of a chat, a routine's run or a task on one time
 * axis you can scrub, from what you asked to the answer. Long waits fold to a
 * break so the work reads at its own pace. The step at the scrubber opens
 * below — what it found, what it changed, a picture of the page — and the
 * list fills in up to it. **Replay** plays it back calmly, a step at a time,
 * with the pearl riding the scrubber; reduced motion keeps the steps and
 * drops the glide.
 */
export function RunReplay({
  steps,
  turns = [],
  speaker = 'Conch',
  onJump,
  initialStep,
  more,
  pace = 900,
  className,
  ...props
}: RunReplayProps) {
  const last = Math.max(0, steps.length - 1);
  const [index, setIndex] = useState(() => Math.min(Math.max(initialStep ?? last, 0), last));
  const [playing, setPlaying] = useState(false);
  const [moved, setMoved] = useState(false);
  const still = usePrefersReducedMotion();
  const { at, breaks } = useMemo(() => replayPositions(steps), [steps]);
  const listRef = useRef<HTMLOListElement>(null);
  const current = steps[Math.min(index, last)];

  // A new timeline (a live chat grew): stay where you were, unless you were at the end.
  const [seen, setSeen] = useState(steps.length);
  if (seen !== steps.length) {
    setSeen(steps.length);
    if (index >= seen - 1 && !playing) setIndex(last);
  }

  useEffect(() => {
    if (!playing || index >= last) return;
    // A calm pace: longer steps linger a little longer, none for long.
    const step = steps[index];
    const wait = Math.max(pace * 0.4, Math.min(pace, (step?.durationMs ?? 0) / 4 || pace * 0.6));
    const timer = setTimeout(() => {
      const next = Math.min(index + 1, last);
      setIndex(next);
      if (next >= last) setPlaying(false);
    }, wait);
    return () => clearTimeout(timer);
  }, [playing, index, last, pace, steps]);

  // The step at hand stays in sight in the list.
  useEffect(() => {
    if (!moved) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    row?.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [index, moved, still]);

  if (!current) {
    return (
      <section className={cx(styles.replay, className)} {...props}>
        <p className={styles.empty}>
          Nothing happened here yet. Its steps will appear as it works.
        </p>
      </section>
    );
  }

  const go = (next: number) => {
    setMoved(true);
    setIndex(Math.min(Math.max(next, 0), last));
  };
  const nearest = (value: number) => {
    let best = 0;
    for (let i = 0; i < at.length; i++)
      if (Math.abs((at[i] ?? 0) - value) < Math.abs((at[best] ?? 0) - value)) best = i;
    return best;
  };
  const turnStart = (from: number, direction: 1 | -1) => {
    const turn = steps[from]?.turn ?? 0;
    if (direction < 0) {
      const first = steps.findIndex((s) => s.turn === turn);
      if (first < from) return first;
      return Math.max(
        0,
        steps.findIndex((s) => s.turn === turn - 1),
      );
    }
    const next = steps.findIndex((s) => s.turn > turn);
    return next < 0 ? last : next;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, () => number> = {
      ArrowRight: () => index + 1,
      ArrowUp: () => index + 1,
      ArrowLeft: () => index - 1,
      ArrowDown: () => index - 1,
      Home: () => 0,
      End: () => last,
      PageUp: () => turnStart(index, -1),
      PageDown: () => turnStart(index, 1),
    };
    const move = moves[event.key];
    if (!move) return;
    // Step by step, not by a sliver of time: Radix leaves the key to us.
    event.preventDefault();
    setPlaying(false);
    go(move());
  };

  const tally = replayTally(steps, turns, index);
  const atEnd = index >= last;
  const startedAt = steps[0]?.at ?? current.at;
  const when = storyDuration(current.at - startedAt);
  const valueText = `Step ${index + 1} of ${steps.length}: ${lineFor(current, speaker)}`;

  return (
    <section
      className={cx(styles.replay, className)}
      data-playing={playing || undefined}
      {...props}
    >
      <p className={styles.tally} aria-live="off">
        <span className={styles.tallyLabel}>{atEnd ? 'In all' : 'By here'}</span>
        <span>{storyDuration(tally.duration)}</span>
        <span aria-hidden>·</span>
        <span>
          {tally.steps} of {steps.length} steps
        </span>
        {tally.tokens > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{tokens(tally.tokens)} tokens</span>
          </>
        )}
        {tally.usd > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{tally.usd < 0.01 ? '<$0.01' : `$${tally.usd.toFixed(2)}`}</span>
          </>
        )}
      </p>

      <div className={styles.deck}>
        <IconButton
          label={playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Replay from here'}
          variant="soft"
          onClick={() => {
            if (playing) return setPlaying(false);
            setMoved(true);
            if (atEnd) setIndex(0);
            setPlaying(true);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <SliderPrimitive.Root
          className={styles.scrub}
          min={0}
          max={1000}
          step={1}
          value={[Math.round((at[index] ?? 0) * 1000)]}
          onValueChange={([value]) => {
            setPlaying(false);
            go(nearest((value ?? 0) / 1000));
          }}
          onKeyDown={onKeyDown}
        >
          <span className={styles.marks} aria-hidden>
            {breaks.map((b) => (
              <i
                key={`b${b}`}
                className={styles.break}
                style={{ insetInlineStart: `${b * 100}%` }}
              />
            ))}
            {steps.map((s, i) => (
              <i
                key={s.id}
                className={styles.mark}
                data-kind={s.kind}
                data-family={s.family}
                data-status={s.status}
                data-ahead={i > index || undefined}
                style={{ insetInlineStart: `${(at[i] ?? 0) * 100}%` }}
              />
            ))}
          </span>
          <SliderPrimitive.Track className={styles.track}>
            <SliderPrimitive.Range className={styles.range} />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            className={styles.thumb}
            aria-label="Step"
            aria-valuetext={valueText}
          >
            {playing ? (
              <Pearl size="xs" state="thinking" label={null} />
            ) : (
              <span className={styles.bead} />
            )}
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>
      </div>

      <article className={styles.now} data-kind={current.kind} data-status={current.status}>
        <header className={styles.nowHead}>
          <Glyph step={current} />
          <div className={styles.nowText}>
            <h3 className={styles.nowTitle}>
              <MorphText text={lineFor(current, speaker)} animate={moved && !still} />
            </h3>
            <p className={styles.nowMeta}>
              <span>at {when}</span>
              {current.durationMs ? <span>took {storyDuration(current.durationMs)}</span> : null}
              {current.status && current.kind !== 'asked' && current.kind !== 'said' && (
                <span className={styles.status} data-status={current.status}>
                  {STATUS_WORDS[current.status]}
                </span>
              )}
            </p>
          </div>
          {onJump && current.anchor && (
            <Button
              size="sm"
              variant="ghost"
              trailingIcon={<ArrowUpRight />}
              onClick={() => onJump(current)}
            >
              Show in chat
            </Button>
          )}
        </header>
        {current.detail && <p className={styles.detail}>{current.detail}</p>}
        {current.shot && (
          <img
            className={styles.shot}
            src={current.shot}
            alt={`The page after: ${current.title}`}
          />
        )}
        {current.diff && <Diff className={styles.diff} diff={current.diff} header={false} />}
        {current.files && current.files.length > 0 && !current.diff && (
          <ul className={styles.files}>
            {current.files.map((f) => (
              <li key={f.path} data-kind={f.kind}>
                <span className={styles.fileKind}>
                  {f.kind === 'created' ? 'Made' : f.kind === 'deleted' ? 'Deleted' : 'Changed'}
                </span>
                <span className={styles.filePath}>{f.path}</span>
              </li>
            ))}
          </ul>
        )}
        {current.peek && !current.diff && current.kind !== 'asked' && (
          <pre className={styles.peek} data-kind={current.kind}>
            {current.peek}
          </pre>
        )}
        {current.kind === 'asked' && current.peek && <p className={styles.words}>{current.peek}</p>}
      </article>

      <ol className={styles.steps} ref={listRef} aria-label="Every step">
        {steps.map((s, i) => (
          <li key={s.id} data-turn-start={i === 0 || steps[i - 1]?.turn !== s.turn || undefined}>
            <button
              type="button"
              className={styles.row}
              data-index={i}
              data-kind={s.kind}
              data-status={s.status}
              data-ahead={i > index || undefined}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => {
                setPlaying(false);
                go(i);
              }}
            >
              <Glyph step={s} />
              <span className={styles.rowTitle}>{lineFor(s, speaker)}</span>
              <span className={styles.rowTime}>
                {s.at - startedAt < 500 ? '0s' : storyDuration(s.at - startedAt)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {more && <p className={styles.more}>This chat goes on: these are its first steps.</p>}
    </section>
  );
}

import { ChevronRight, Hourglass } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import { LiveLine, type LiveLineSource } from '../LiveLine/LiveLine';
import { Odometer } from '../ThinkingIndicator/Odometer';
import { formatElapsed } from '../ThinkingIndicator/ThinkingIndicator';
import { ChipList, ChipStack, chipsSaid } from './Chips';
import { FamilyGlyph } from './FamilyGlyph';
import { storyDuration, stepsLabel, useNow } from './format';
import { MorphText } from './MorphText';
import { WorkedAt } from '../WorkPlaces/WorkedAt';
import styles from './Story.module.css';
import type { StoryChip, StoryFamily, StorySource } from './types';

/**
 * `declined`: its only steps that mattered were ones you said no to (or a
 * rule stopped): over, and neutral. Neither the check of done nor the warm
 * note of a failure.
 */
export type StoryStatus = 'running' | 'done' | 'failed' | 'declined';
/**
 * `declined`: it asked first and didn't run, because the answer was no (or a
 * rule said no). Neutral, never the warm note of a failure.
 */
export type StoryStepStatus = 'pending' | 'running' | 'success' | 'error' | 'declined';

/** One tool call inside a story, in words (the protocol's `ToolLabel`, resolved for its status). */
export interface StoryStepView {
  /** The tool call's id: what `renderRaw`, `renderFound` and `onExplain` are asked about. */
  id: string;
  /** "Ran the server tests" once done, "Running the server tests" while it runs. */
  text: string;
  /** What it found: "241 passed", "3 matches", "exit 1". */
  outcome?: string;
  status: StoryStepStatus;
  family: StoryFamily;
  /** The file, page, query or command it's about, short. */
  subject?: string;
  durationMs?: number;
  startedAt?: number;
  /** It went wrong in a way worth saying, beyond its status (a test that failed). */
  failed?: boolean;
  /** Where the command ran, when it wasn't this computer (ADR 0106): a tag on its row. */
  where?: { kind: 'container' | 'ssh' | 'cloud'; name: string };
  /**
   * `false`: no "Why?" on this step. Something said by its own event (a
   * memory kept or forgotten) has no call in the log for Why? to ask about.
   */
  explainable?: boolean;
}

/**
 * What "Why?" comes back with: the answer itself, nothing (no one to ask),
 * or the protocol's `ExplainStepResult` as it is.
 */
export type StoryExplanation = string | undefined | { answer?: string; unavailable?: string };

export interface StoryProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** What the run of steps came to, in the past tense once done: "Ran the server tests". */
  headline: string;
  /** A second, quieter phrase for the result: "241 files", "7,388 passed". */
  outcome?: string;
  family: StoryFamily;
  status: StoryStatus;
  /** While running: what the current step is doing, or the assistant's own narration. */
  live?: string;
  /** Who wrote `live`. The assistant's own words are set apart (see `LiveLine`). */
  liveSource?: LiveLineSource;
  steps: StoryStepView[];
  /** What it touched: sites, files, pictures. A small stack in the row; pills when open. */
  chips?: StoryChip[];
  /** How many repeats of the same call were folded into it. */
  repeats?: number;
  /** A gentle sentence when it's taking longer than it should: "Still waiting on the build". */
  stuck?: string;
  /** Epoch ms when it started: the clock ticks from here while it runs. */
  startedAt?: number;
  /** How long it took, once it's over. */
  durationMs?: number;
  /** Where the headline came from. When it changes (a small model's words arriving), it morphs. */
  headlineSource?: StorySource;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The raw call behind a step (input, output, diff): shown when the step is opened. */
  renderRaw?: (stepId: string) => ReactNode;
  /** What a step found, drawn as it is (sources, files, an agenda): always under it when open. */
  renderFound?: (stepId: string) => ReactNode;
  /** "Why?" on a step: one to three sentences from the chat's log, or why there's none. */
  onExplain?: (stepId: string) => Promise<StoryExplanation>;
  /**
   * The story is arriving now, in a live turn: changes play (the headline
   * morphs, the glyph settles, the check draws itself) and its start and end
   * are announced. History leaves it off and is drawn still.
   */
  arriving?: boolean;
  /**
   * The run it's part of isn't over: one step has ended and the next hasn't
   * started yet (the assistant is thinking between them). The row holds as it
   * was while working — its words, its clock, its line beneath, which says
   * `live` or "Thinking…" — so nothing folds and comes back between steps.
   */
  continuing?: boolean;
}

/** What the line beneath says between two steps of a run that goes on. */
const STORY_BETWEEN = 'Thinking…';

/** Asked and not run: a circle with a slash, quiet gray. */
function NotRun() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="6" cy="6" r="4.6" />
      <path d="M2.8 9.2 9.2 2.8" strokeLinecap="round" />
    </svg>
  );
}

/** The last value something had, so a line that's leaving keeps its words as it folds away. */
function useLast<T>(value: T | undefined): T | undefined {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
}

/** What something said the last time `when` held: a row between two steps keeps its working words. */
function useHeldWhile<T>(value: T, when: boolean): T {
  const [held, setHeld] = useState(value);
  if (when && value !== held) setHeld(value);
  return when ? value : held;
}

const SPOKEN: Record<StoryStatus, string> = {
  running: 'working',
  done: 'done',
  failed: 'didn’t work',
  declined: 'not run',
};

export interface StoryMarkProps {
  family: StoryFamily;
  status: StoryStatus;
  /** Play the landing: the badge settles, its tick draws itself (and checks that pass glint). */
  arriving?: boolean;
  className?: string;
}

/**
 * A story's mark: its family's glyph in a small well, which lives while the
 * work runs; the status lands on it as a badge once it ends. Decorative.
 */
export function StoryMark({ family, status, arriving = false, className }: StoryMarkProps) {
  return (
    <span
      className={cx(styles.well, className)}
      data-status={status}
      data-arriving={arriving || undefined}
      aria-hidden
    >
      <span className={styles.orbit} />
      <FamilyGlyph family={family} active={status === 'running'} className={styles.glyph} />
      {status !== 'running' && (
        // Keyed by status, so a change re-mounts and settles in.
        <span key={status} className={styles.badge} data-status={status}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeLinecap="round">
            {status === 'done' ? (
              <path d="M3.4 6.3 5.2 8.1 8.7 4.2" strokeLinejoin="round" pathLength={1} />
            ) : status === 'declined' ? (
              <path d="M3.9 8.1 8.1 3.9" />
            ) : (
              <path d="M6 3.4v3.1M6 8.7v.01" />
            )}
          </svg>
        </span>
      )}
      {arriving && status === 'done' && family === 'verify' && <span className={styles.glint} />}
    </span>
  );
}

function Clock({
  status,
  startedAt,
  durationMs,
}: Pick<StoryProps, 'status' | 'startedAt' | 'durationMs'>) {
  const running = status === 'running';
  const now = useNow(running && startedAt !== undefined);
  if (running && startedAt !== undefined) {
    const elapsed = now - startedAt;
    if (elapsed < 1000) return null;
    return (
      <span className={styles.clock}>
        <Odometer value={formatElapsed(elapsed).replace(' ', '\u00a0')} />
      </span>
    );
  }
  if (!running && durationMs !== undefined)
    return <span className={styles.clock}>{storyDuration(durationMs)}</span>;
  return null;
}

type Why =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'answer'; text: string }
  | { phase: 'unavailable'; text: string };

const NO_ANSWER = 'There’s no answer for this one right now.';

function normalise(result: StoryExplanation): Why {
  if (typeof result === 'string')
    return result.trim()
      ? { phase: 'answer', text: result.trim() }
      : { phase: 'unavailable', text: NO_ANSWER };
  if (result?.answer?.trim()) return { phase: 'answer', text: result.answer.trim() };
  return { phase: 'unavailable', text: result?.unavailable ?? NO_ANSWER };
}

/** The answer to "Why?", its words arriving one after another like the reply's own. */
function Answer({ text }: { text: string }) {
  const words = text.split(/(\s+)/).filter(Boolean);
  let i = 0;
  return (
    <p className={styles.answer}>
      {words.map((w, k) =>
        /\S/.test(w) ? (
          <span key={k} className={styles.word} style={{ '--i': i++ } as CSSProperties}>
            {w}
          </span>
        ) : (
          w
        ),
      )}
    </p>
  );
}

function StepRow({
  step,
  last,
  arriving,
  renderRaw,
  renderFound,
  onExplain,
}: {
  step: StoryStepView;
  last: boolean;
  arriving: boolean;
} & Pick<StoryProps, 'renderRaw' | 'renderFound' | 'onExplain'>) {
  const textId = useId();
  const whyId = useId();
  const [why, setWhy] = useState<Why>({ phase: 'idle' });
  const [whyOpen, setWhyOpen] = useState(false);
  const asked = useRef(false);
  const raw = renderRaw?.(step.id);
  const found = renderFound?.(step.id);
  const wrong = step.status === 'error' || step.failed;

  const ask = () => {
    if (whyOpen) {
      setWhyOpen(false);
      return;
    }
    setWhyOpen(true);
    if (asked.current || !onExplain) return;
    asked.current = true;
    setWhy({ phase: 'loading' });
    onExplain(step.id).then(
      (result) => setWhy(normalise(result)),
      () => {
        asked.current = false;
        setWhy({ phase: 'unavailable', text: 'Couldn’t ask just now.' });
      },
    );
  };

  const body = (
    <>
      <span className={styles.stepLine}>
        <span id={textId} className={styles.stepText}>
          {step.text}
        </span>
        {step.outcome && (
          <>
            {' '}
            <span className={styles.dot} aria-hidden>
              ·
            </span>
            <span className={styles.stepOutcome}>{step.outcome}</span>
          </>
        )}
        {wrong && <span className="nc-visually-hidden">, didn’t work</span>}
        {step.status === 'declined' && <span className="nc-visually-hidden">, not run</span>}
      </span>
      {step.subject && (
        <>
          {' '}
          <span className={styles.subject}>{step.subject}</span>
        </>
      )}
    </>
  );
  const trail = (
    <>
      {step.where && (
        <WorkedAt kind={step.where.kind} name={step.where.name} className={styles.stepWhere} />
      )}
      {step.durationMs !== undefined && step.status !== 'running' && (
        <span className={styles.stepTime}>{storyDuration(step.durationMs)}</span>
      )}
      {raw != null && <ChevronRight aria-hidden className={styles.stepChevron} />}
    </>
  );

  return (
    <Collapsible.Root asChild disabled={raw == null}>
      <li
        className={styles.step}
        data-status={step.status}
        data-failed={wrong || undefined}
        data-last={last || undefined}
        data-raw={raw != null || undefined}
        data-arriving={arriving || undefined}
      >
        <span className={styles.stepDot} aria-hidden>
          {step.status === 'declined' && <NotRun />}
        </span>
        <div className={styles.stepMain}>
          <div className={styles.stepHead}>
            {raw != null ? (
              <Collapsible.Trigger className={styles.stepToggle}>
                <span className={styles.stepBody}>{body}</span>
                {trail}
              </Collapsible.Trigger>
            ) : (
              <div className={styles.stepToggle}>
                <span className={styles.stepBody}>{body}</span>
                {trail}
              </div>
            )}
            {onExplain && step.explainable !== false && (
              <button
                type="button"
                className={styles.why}
                data-open={whyOpen || undefined}
                aria-expanded={whyOpen}
                aria-controls={whyOpen ? whyId : undefined}
                aria-describedby={textId}
                onClick={ask}
              >
                Why?
              </button>
            )}
          </div>
          {whyOpen && (
            <div id={whyId} className={styles.whyBox} data-phase={why.phase} aria-live="polite">
              {why.phase === 'loading' && (
                <p className={styles.asking} aria-busy>
                  Finding out why…
                </p>
              )}
              {why.phase === 'answer' && <Answer text={why.text} />}
              {why.phase === 'unavailable' && <p className={styles.unavailable}>{why.text}</p>}
            </div>
          )}
          {found != null && <div className={styles.found}>{found}</div>}
          {raw != null && (
            <Collapsible.Content className={styles.rawContent}>
              <div className={styles.raw}>{raw}</div>
            </Collapsible.Content>
          )}
        </div>
      </li>
    </Collapsible.Root>
  );
}

/**
 * A run of the assistant's steps, told as one line (ADR 0103): what it is
 * doing or did, in plain words — "Ran the server tests · 241 files" — with
 * the family's glyph, what it touched, how many steps and how long. While it
 * runs, the glyph lives a little and a line beneath says the step at hand.
 * Open it for the steps themselves on a thin timeline, each one asking
 * "Why?" and opening once more to the exact call. Calm when something fails:
 * a warm note, never a red flood.
 */
export function Story({
  headline: toldHeadline,
  outcome: toldOutcome,
  family,
  status: told,
  continuing = false,
  live,
  liveSource,
  steps,
  chips,
  repeats = 0,
  stuck,
  startedAt,
  durationMs,
  headlineSource,
  open,
  defaultOpen,
  onOpenChange,
  renderRaw,
  renderFound,
  onExplain,
  arriving = false,
  className,
  ...props
}: StoryProps) {
  // Between two steps of a run that goes on, the row is still at work: it
  // keeps the words it had while working, its clock ticks on, no badge lands
  // and its line stays, so its height never folds and comes back.
  const status: StoryStatus = continuing ? 'running' : told;
  const running = status === 'running';
  const fresh = told === 'running' || !continuing;
  const headline = useHeldWhile(toldHeadline, fresh);
  const outcome = useHeldWhile(toldOutcome, fresh);
  // While it works the line beneath always has words, so its height is held.
  const atHand =
    told === 'running'
      ? steps.findLast((s) => s.status === 'running' || s.status === 'pending')?.text
      : undefined;
  const lineText = running ? (stuck ?? live ?? atHand ?? STORY_BETWEEN) : undefined;
  const shownLine = useLast(lineText);
  const lineIsStuck = running && stuck !== undefined;
  const hasChips = chips !== undefined && chips.length > 0;
  // The row's stack shows faces worth seeing (favicons, photos); files are said by the headline.
  const faces = chips?.filter((c) => c.image || c.kind === 'site') ?? [];
  const expandable = steps.length > 0 || hasChips;
  // Its commands ran elsewhere, all in one place (ADR 0106): said on the row itself.
  const placed = steps.filter((s) => s.where);
  const where =
    placed[0]?.where &&
    placed.every(
      (s) => s.where?.kind === placed[0]?.where?.kind && s.where?.name === placed[0]?.where?.name,
    )
      ? placed[0].where
      : undefined;

  // Said once when it starts and once when it ends, never for each step.
  const [said, setSaid] = useState('');
  const announced = useRef<StoryStatus | undefined>(undefined);
  useEffect(() => {
    if (!arriving || announced.current === status) return;
    announced.current = status;
    setSaid(
      status === 'running'
        ? `Started: ${headline}`
        : status === 'done'
          ? `Done: ${headline}${outcome ? `, ${outcome}` : ''}`
          : status === 'declined'
            ? `Not run: ${headline}${outcome ? `, ${outcome}` : ''}`
            : `Didn’t work: ${headline}`,
    );
  }, [arriving, status, headline, outcome]);

  const time = !running && durationMs !== undefined ? `, took ${storyDuration(durationMs)}` : '';
  const spokenTail = `, ${stepsLabel(steps.length)}${repeats ? `, ${repeats} repeats folded` : ''}${
    hasChips ? `, ${chipsSaid(chips)}` : ''
  }${where ? `, ${where.kind === 'ssh' ? `ran on ${where.name}` : where.kind === 'container' ? 'ran in a container' : 'ran in the cloud'}` : ''}, ${SPOKEN[status]}${time}`;

  return (
    <Collapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={!expandable}
      asChild
    >
      <div
        className={cx(styles.root, className)}
        data-status={status}
        data-family={family}
        data-source={headlineSource}
        data-arriving={arriving || undefined}
        {...props}
      >
        <Collapsible.Trigger className={styles.header} data-lustre="">
          <StoryMark family={family} status={status} arriving={arriving} />
          <span className={styles.title}>
            <MorphText text={headline} animate={arriving} className={styles.headline} />
            {/* "×3" only where the line is one thing done again: beside "Read 3 pages" it
                would say the whole story happened twice. Opened, the fold says it. */}
            {repeats > 0 && steps.length <= 1 && (
              <span className={styles.times} aria-hidden>
                ×{repeats + 1}
              </span>
            )}
            {outcome && ' '}
            {outcome && (
              <span className={styles.outcome}>
                <span className={styles.dot} aria-hidden>
                  ·
                </span>
                <MorphText text={outcome} animate={arriving} />
              </span>
            )}
          </span>
          <span className={styles.meta} aria-hidden>
            {where && <WorkedAt kind={where.kind} name={where.name} />}
            {faces.length > 0 && <ChipStack chips={faces} />}
            {steps.length > 1 && <span className={styles.count}>{stepsLabel(steps.length)}</span>}
            <Clock status={status} startedAt={startedAt} durationMs={durationMs} />
            {expandable && <ChevronRight className={styles.chevron} />}
          </span>
          <span className="nc-visually-hidden">{spokenTail}</span>
        </Collapsible.Trigger>

        <div
          className={styles.below}
          data-shown={lineText !== undefined || undefined}
          data-stuck={lineIsStuck || undefined}
        >
          <div className={styles.belowInner}>
            {shownLine !== undefined &&
              (lineIsStuck ? (
                <p className={styles.stuck}>
                  <Hourglass aria-hidden />
                  <span>{shownLine}</span>
                </p>
              ) : (
                <LiveLine
                  text={shownLine}
                  source={liveSource}
                  active={running}
                  announce={false}
                  className={styles.live}
                />
              ))}
          </div>
        </div>

        {expandable && (
          <Collapsible.Content className={styles.content}>
            <div className={styles.panel}>
              {hasChips && <ChipList chips={chips} label="What it looked at" />}
              {steps.length > 0 && (
                <ol className={styles.timeline} aria-label="Steps">
                  {steps.map((step, i) => (
                    <StepRow
                      key={step.id}
                      // Said once on the row when every command ran there; per step when they differ.
                      step={where && step.where ? { ...step, where: undefined } : step}
                      last={i === steps.length - 1}
                      arriving={arriving}
                      renderRaw={renderRaw}
                      renderFound={renderFound}
                      onExplain={onExplain}
                    />
                  ))}
                </ol>
              )}
              {repeats > 0 && (
                <p className={styles.repeats}>
                  +{repeats} {repeats === 1 ? 'repeat' : 'repeats'} folded
                </p>
              )}
            </div>
          </Collapsible.Content>
        )}

        <span className="nc-visually-hidden" role="status">
          {said}
        </span>
      </div>
    </Collapsible.Root>
  );
}

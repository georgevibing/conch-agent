import { useReducedMotionConfig } from 'motion/react';
import type { ComponentProps, CSSProperties } from 'react';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { AgentAvatar } from '../AgentAvatar/AgentAvatar';
import type { AgentFace } from '../AgentAvatar/presets';
import styles from './AgentRound.module.css';

/** Someone in a round: one of your agents, or an outside one. */
export interface RoundFace {
  id: string;
  name: string;
  avatar?: AgentFace | string;
  /** An agent elsewhere (A2A): its words are someone else's. */
  outside?: boolean;
}

export interface AgentRoundProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** Everyone in the round, in the order they were named. */
  faces: RoundFace[];
  /** Who spoke, in order, by id: each step is drawn as an arc from one face to the next. */
  passes: string[];
  /** Who has the floor now. */
  speaking?: string;
  /** Replies a round may take before it stops for you. */
  limit: number;
  /** It's over: why, in words ('' when it simply finished). */
  ended?: { words: string };
  /** Stop the round now (shown while it goes). */
  onStop?: () => void;
}

/** Geometry in slot units: each face is 10 wide, the arcs sit above the faces' tops. */
const SLOT = 10;
const BASE = 8;

function arc(from: number, to: number): string {
  const x1 = from * SLOT + SLOT / 2;
  const x2 = to * SLOT + SLOT / 2;
  const span = Math.abs(to - from);
  // The control point rises twice the arc's height. Leftward arcs rise higher,
  // so a pass and its answer never lie on one line.
  const rise = Math.min(15, 4.2 + span * 2.2) + (to < from ? 1.6 : 0);
  return `M ${x1} ${BASE} Q ${(x1 + x2) / 2} ${BASE - rise} ${x2} ${BASE}`;
}

/** A face: yours wear their own; an outside agent, its initials (it has no face in Conch). */
function Face({ face, size, active }: { face: RoundFace; size: 'xs' | 'lg'; active?: boolean }) {
  return face.outside ? (
    <Avatar name={face.name} size={size} aria-hidden />
  ) : (
    <AgentAvatar name={face.name} avatar={face.avatar} size={size} active={active} decorative />
  );
}

function names(list: readonly { name: string }[]): string {
  const all = list.map((f) => f.name);
  if (all.length <= 1) return all[0] ?? '';
  return `${all.slice(0, -1).join(', ')} and ${all.at(-1) as string}`;
}

/**
 * Agents taking turns (ADR 0112): everyone in the round as a row of faces,
 * and every pass of the floor as an arc of pearl light from one face to the
 * next — the newest drawn bright, with a pearl that travels along it as the
 * floor changes hands. Whoever has the floor wears its working light; an
 * outside agent is marked as one. While it goes it says who's answering and
 * how far the round has come, with Stop; once it's over it folds to one
 * quiet line, and why it stopped when that's worth saying.
 *
 * The picture is decoration: the words beside it say the same, and the line
 * of who's answering is announced as it changes.
 */
export function AgentRound({
  faces,
  passes,
  speaking,
  limit,
  ended,
  onStop,
  className,
  ...props
}: AgentRoundProps) {
  // Nacre's own setting and the person's system alike (`NacreProvider`'s MotionConfig).
  const still = useReducedMotionConfig() === true;
  const index = new Map(faces.map((f, i) => [f.id, i]));
  const steps = passes
    .slice(1)
    .map((to, i) => ({ from: index.get(passes[i] as string), to: index.get(to) }))
    .filter((s): s is { from: number; to: number } => s.from !== undefined && s.to !== undefined);
  const now = speaking ? faces.find((f) => f.id === speaking) : undefined;
  const replies = passes.length;

  if (ended) {
    const spoke = faces.filter((f) => passes.includes(f.id));
    return (
      <section
        className={cx(styles.round, className)}
        data-state="ended"
        aria-label="Agents took turns"
        {...props}
      >
        <div className={styles.folded}>
          <span className={styles.stack} aria-hidden>
            {(spoke.length ? spoke : faces).slice(0, 5).map((f) => (
              <Face key={f.id} face={f} size="xs" />
            ))}
          </span>
          <p className={styles.line}>
            {spoke.length > 1
              ? `${names(spoke)} took turns`
              : `${names(spoke.length ? spoke : faces)} answered`}
            <span className={styles.count}>
              {' · '}
              {replies} {replies === 1 ? 'reply' : 'replies'}
            </span>
          </p>
        </div>
        {ended.words && <p className={styles.why}>{ended.words}</p>}
      </section>
    );
  }

  const width = faces.length * SLOT;
  const latest = steps.at(-1);
  return (
    <section
      className={cx(styles.round, className)}
      data-state="going"
      aria-label="Agents taking turns"
      {...props}
    >
      <div className={styles.head}>
        <p className={styles.title}>Taking turns</p>
        <p className={styles.meta}>
          {replies} of {limit} replies
        </p>
        {onStop && (
          <Button size="sm" variant="ghost" tone="neutral" onClick={onStop} className={styles.stop}>
            Stop
          </Button>
        )}
      </div>
      <div className={styles.stage} style={{ '--ar-count': faces.length } as CSSProperties}>
        <svg
          className={styles.arcs}
          viewBox={`0 0 ${width} ${BASE + 0.4}`}
          aria-hidden
          focusable="false"
        >
          {steps.map((s, i) => (
            <path
              key={`${i}-${s.from}-${s.to}`}
              d={arc(s.from, s.to)}
              pathLength={1}
              data-arc=""
              className={styles.arc}
              data-latest={i === steps.length - 1 || undefined}
              style={{ '--ar-age': steps.length - 1 - i } as CSSProperties}
            />
          ))}
          {latest && (
            <circle
              key={`pearl-${steps.length}`}
              className={styles.pearl}
              r={0.85}
              {...(still
                ? {
                    cx: latest.to * SLOT + SLOT / 2,
                    cy: BASE,
                  }
                : {})}
            >
              {!still && (
                <animateMotion
                  dur="0.9s"
                  fill="freeze"
                  path={arc(latest.from, latest.to)}
                  calcMode="spline"
                  keyTimes="0;1"
                  keySplines="0.3 0 0.2 1"
                />
              )}
            </circle>
          )}
        </svg>
        <ol className={styles.faces}>
          {faces.map((f) => {
            const on = f.id === speaking;
            const turns = passes.filter((p) => p === f.id).length;
            return (
              <li
                key={f.id}
                className={styles.face}
                data-speaking={on || undefined}
                data-spoke={turns > 0 || undefined}
                data-outside={f.outside || undefined}
              >
                <Face face={f} size="lg" active={on} />
                <span className={styles.name}>{f.name}</span>
                {f.outside && (
                  <span className={styles.tag} aria-hidden>
                    outside
                  </span>
                )}
                <span className="nc-visually-hidden">
                  {f.outside ? ', an outside agent' : ''}
                  {on
                    ? ', answering now'
                    : turns
                      ? `, spoke ${turns === 1 ? 'once' : `${turns} times`}`
                      : ', waiting'}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className={styles.live} aria-live="polite">
        {now
          ? now.outside
            ? `Waiting for ${now.name}…`
            : `${now.name} is answering`
          : 'Passing it on…'}
      </p>
    </section>
  );
}

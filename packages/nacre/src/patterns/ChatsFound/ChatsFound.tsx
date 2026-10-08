import {
  useEffect,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Pearl } from '../../components/Pearl';
import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import { ProviderLogo, type ProviderId } from '../ModelPicker/ProviderLogo';
import { Odometer, useCountUp } from '../ThinkingIndicator/Odometer';
import styles from './ChatsFound.module.css';

/** One app whose chats were found. */
export interface ChatsFoundSource {
  id: string;
  /** "Claude Code". */
  label: string;
  /** Its mark, when Nacre has one; otherwise its initial. */
  logo?: ProviderId;
  /** Conversations found there (or, once brought in, how many came). */
  count: number;
  /** The projects with the most, most first: “shop”, “garden”. */
  projects?: { name: string; count: number }[];
  /** A few words of when: “since March 2025”. */
  when?: ReactNode;
}

export type ChatsFoundPhase = 'found' | 'bringing' | 'done';

export interface ChatsFoundProps extends Omit<ComponentProps<'section'>, 'title'> {
  sources: ChatsFoundSource[];
  /** `found`: the offer. `bringing`: on their way in. `done`: they're here. */
  phase?: ChatsFoundPhase;
  /** How far bringing them in is. */
  progress?: { done: number; total: number; current?: ReactNode };
  /** The heading's words around the count; “Found 1,284 conversations” when left out. */
  title?: (count: ReactNode) => ReactNode;
  /** The line under it; “from Claude Code and Codex. Bring them in?” when left out. */
  lead?: ReactNode;
  /** A sentence of reassurance under the list. */
  note?: ReactNode;
  /** The one press (and Not now). */
  action?: ReactNode;
  /** Projects shown per app before “and N more”. */
  projectsShown?: number;
}

const nf = new Intl.NumberFormat('en');

/** “Claude Code”, “Claude Code and Codex”, “Claude Code, Codex and Gemini CLI”. */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** An app's mark: its logo, or its initial on a tile. */
export function ChatSourceMark({
  label,
  logo,
  size = 'md',
  className,
  style,
}: {
  label: string;
  logo?: ProviderId;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cx(styles.mark, className)} data-size={size} style={style} aria-hidden>
      {logo ? (
        <ProviderLogo provider={logo} size={size === 'sm' ? 14 : 18} />
      ) : (
        <span className={styles.initial}>{label.trim().charAt(0).toUpperCase() || '?'}</span>
      )}
    </span>
  );
}

/**
 * The moment Conch finds your past conversations (ADR 0111): every app's
 * mark gathered on the left, a stream of light flowing into the pearl, and
 * the count turning up on its wheels to how many there are. Below, each app
 * with its count and its busiest projects, then one press. While they come
 * in the stream quickens and a bar fills; once they're here the pearl
 * glows. With reduced motion the count simply is, and nothing travels.
 */
export function ChatsFound({
  sources,
  phase = 'found',
  progress,
  title,
  lead,
  note,
  action,
  projectsShown = 3,
  className,
  ...props
}: ChatsFoundProps) {
  const total = sources.reduce((n, s) => n + s.count, 0);
  // From nothing to the count, once it's on screen: the find, felt.
  const [target, setTarget] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTarget(total));
    return () => cancelAnimationFrame(frame);
  }, [total]);
  const shown = useCountUp(target, 1200);
  const words = nf.format(total);
  const count = (
    <span className={styles.count}>
      <Odometer value={nf.format(shown)} aria-hidden />
      <span className="nc-visually-hidden">{words}</span>
    </span>
  );
  const heading = title ? (
    title(count)
  ) : (
    <>
      Found {count} {total === 1 ? 'conversation' : 'conversations'}
    </>
  );
  return (
    <section
      className={cx(styles.found, className)}
      data-phase={phase}
      aria-busy={phase === 'bringing' || undefined}
      {...props}
    >
      <div className={styles.constellation} aria-hidden>
        <span className={styles.marks}>
          {sources.slice(0, 5).map((s, i) => (
            <ChatSourceMark
              key={s.id}
              label={s.label}
              {...(s.logo && { logo: s.logo })}
              className={styles.stacked}
              style={{ '--cf-i': i } as CSSProperties}
            />
          ))}
        </span>
        <span className={styles.stream}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={styles.spark} style={{ '--cf-i': i } as CSSProperties} />
          ))}
        </span>
        <Pearl
          size="lg"
          label={null}
          state={phase === 'bringing' ? 'streaming' : 'idle'}
          className={styles.pearl}
        />
      </div>

      <div className={styles.words}>
        <h2 className={styles.title}>{heading}</h2>
        <p className={styles.lead}>
          {lead ?? `from ${listWords(sources.map((s) => s.label))}. Bring them in?`}
        </p>
      </div>

      <ul className={styles.sources} aria-label="Where they’re from">
        {sources.map((s, i) => {
          const projects = s.projects ?? [];
          const more = projects.length - projectsShown;
          return (
            <li key={s.id} className={styles.source} style={{ '--cf-i': i } as CSSProperties}>
              <ChatSourceMark label={s.label} {...(s.logo && { logo: s.logo })} />
              <span className={styles.sourceText}>
                <span className={styles.sourceHead}>
                  <span className={styles.sourceLabel}>{s.label}</span>
                  <span className={styles.sourceCount}>
                    {nf.format(s.count)} {s.count === 1 ? 'chat' : 'chats'}
                  </span>
                </span>
                {(projects.length > 0 || s.when) && (
                  <span className={styles.sourceDetail}>
                    {projects.slice(0, projectsShown).map((p) => (
                      <span key={p.name} className={styles.project}>
                        {p.name}
                        <span className={styles.projectCount}>{nf.format(p.count)}</span>
                      </span>
                    ))}
                    {more > 0 && <span className={styles.more}>and {more} more</span>}
                    {s.when && <span className={styles.when}>{s.when}</span>}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {phase === 'bringing' && progress && (
        <div className={styles.progress}>
          <Progress
            value={progress.total ? progress.done : null}
            max={Math.max(progress.total, 1)}
            label="Bringing them in"
            showValue={(v, max) => `${nf.format(v)} of ${nf.format(max)}`}
          />
          <p className={styles.current} aria-live="polite">
            {progress.current}
          </p>
        </div>
      )}

      {note && <p className={styles.note}>{note}</p>}
      {action && <div className={styles.actions}>{action}</div>}
    </section>
  );
}

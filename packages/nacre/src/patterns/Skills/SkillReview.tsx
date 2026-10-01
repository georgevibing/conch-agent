import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './SkillReview.module.css';

export interface SkillReviewFinding {
  severity: 'danger' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

export interface SkillReviewProps extends Omit<ComponentProps<'section'>, 'title'> {
  verdict: 'clean' | 'caution' | 'danger';
  findings: SkillReviewFinding[];
  /** Why the skill is off for now: "It changed in OpenClaw since you turned it on." */
  note?: ReactNode;
  /** The one thing to do: "Turn it on anyway", "Look again". */
  action?: ReactNode;
}

const TITLES = {
  clean: 'Conch read every file in it: nothing worrying',
  caution: 'Worth a look before you use it',
  danger: 'Conch found something worrying',
} as const;

/**
 * What Conch saw reading a skill (ADR 0028), in plain words: a quiet line
 * when it's fine, the findings when it isn't, each with where it is. Never
 * an alarm for its own sake: it says what the skill would do.
 */
export function SkillReview({
  verdict,
  findings,
  note,
  action,
  className,
  ...props
}: SkillReviewProps) {
  const titleId = useId();
  const Icon =
    verdict === 'clean' ? ShieldCheck : verdict === 'caution' ? ShieldQuestion : ShieldAlert;
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.review, className)}
      data-verdict={verdict}
      {...props}
    >
      <div className={styles.head}>
        <Icon aria-hidden className={styles.icon} />
        <p className={styles.title} id={titleId}>
          {TITLES[verdict]}
        </p>
      </div>
      {note && <p className={styles.note}>{note}</p>}
      {findings.length > 0 && (
        <ul className={styles.findings}>
          {findings.map((f, i) => (
            <li key={`${f.file}:${f.line}:${i}`} data-severity={f.severity}>
              <span>{f.message}</span>
              {f.file && (
                <code className={styles.where}>
                  {f.file}
                  {f.line ? `:${f.line}` : ''}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}
      {action && <div className={styles.action}>{action}</div>}
    </section>
  );
}

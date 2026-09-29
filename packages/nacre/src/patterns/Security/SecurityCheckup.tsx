import { CheckCircle2, Info, OctagonAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './Security.module.css';

export type CheckLevel = 'ok' | 'info' | 'warn' | 'danger';

export interface CheckItem {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  /** A terminal command that fixes it. */
  command?: string;
  /** An in-app fix, e.g. a small Button. */
  action?: ReactNode;
}

export interface SecurityCheckupProps extends ComponentProps<'section'> {
  items: CheckItem[];
}

const icons: Record<CheckLevel, ReactNode> = {
  ok: <CheckCircle2 />,
  info: <Info />,
  warn: <TriangleAlert />,
  danger: <OctagonAlert />,
};

const levelText: Record<CheckLevel, string> = {
  ok: 'Passed',
  info: 'Suggestion',
  warn: 'Warning',
  danger: 'Needs attention',
};

/**
 * A plain-language security checkup. Problems come first, each with what it
 * means and how to fix it; passed checks shrink to a quiet list so the
 * good news never drowns out a real warning.
 */
export function SecurityCheckup({ items, className, ...props }: SecurityCheckupProps) {
  const problems = items.filter((i) => i.level === 'warn' || i.level === 'danger');
  const worst = items.some((i) => i.level === 'danger')
    ? 'danger'
    : problems.length
      ? 'warn'
      : 'ok';
  const headline =
    worst === 'ok'
      ? 'Looking good'
      : `${problems.length} ${problems.length === 1 ? 'thing needs' : 'things need'} your attention`;
  return (
    <section
      aria-label="Security checkup"
      data-level={worst}
      className={cx(styles.checkup, className)}
      {...props}
    >
      <header className={styles.checkupHead}>
        <span className={styles.checkupIcon} aria-hidden>
          {worst === 'ok' ? <ShieldCheck /> : icons[worst]}
        </span>
        <p className={styles.checkupTitle}>{headline}</p>
      </header>
      <ul className={styles.checks}>
        {items.map((item) => (
          <li key={item.id} className={styles.check} data-level={item.level}>
            <span className={styles.checkIcon} aria-hidden>
              {icons[item.level]}
            </span>
            <div className={styles.checkBody}>
              <p className={styles.checkTitle}>
                <span className="nc-visually-hidden">{levelText[item.level]}: </span>
                {item.title}
              </p>
              {item.level !== 'ok' && <p className={styles.checkDetail}>{item.detail}</p>}
              {item.command && (
                <div className={styles.command}>
                  <code>{item.command}</code>
                  <CopyButton value={item.command} label="Copy command" />
                </div>
              )}
            </div>
            {item.action && <div className={styles.checkAction}>{item.action}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

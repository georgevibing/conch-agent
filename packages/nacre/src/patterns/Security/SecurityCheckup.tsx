import {
  ArrowRight,
  CheckCircle2,
  Info,
  OctagonAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './Security.module.css';

export type CheckLevel = 'ok' | 'info' | 'warn' | 'danger';

/** The one button that fixes a finding. */
export interface CheckFix {
  /** A few words saying what pressing it does: “Turn off”, “Review keys”. */
  label: string;
  /**
   * `open` takes you somewhere to decide (it shows an arrow); `act` makes the
   * change right here. Default `act`.
   */
  kind?: 'open' | 'act';
  /** Runs the fix. While a returned promise is pending, the button shows progress. */
  onFix: () => unknown;
}

export interface CheckItem {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  /** A terminal command that fixes it, when only a person can. */
  command?: string;
  /** The button that fixes it. */
  fix?: CheckFix;
  /** Any other in-app control, when a single fix button isn't the right shape. */
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

function FixButton({ fix, describedBy }: { fix: CheckFix; describedBy: string }) {
  const [busy, setBusy] = useState(false);
  const run = () => {
    const result = fix.onFix();
    if (result instanceof Promise) {
      setBusy(true);
      // The item usually disappears once fixed; if it doesn't, the button is ready again.
      void result.catch(() => undefined).finally(() => setBusy(false));
    }
  };
  return (
    <Button
      size="sm"
      variant="surface"
      loading={busy}
      trailingIcon={fix.kind === 'open' ? <ArrowRight /> : undefined}
      aria-describedby={describedBy}
      onClick={run}
    >
      {fix.label}
    </Button>
  );
}

function Check({ item }: { item: CheckItem }) {
  const titleId = useId();
  // A check that passed has nothing to fix.
  const control =
    item.fix && item.level !== 'ok' ? (
      <FixButton fix={item.fix} describedBy={titleId} />
    ) : (
      item.action
    );
  return (
    <li className={styles.check} data-level={item.level}>
      <span className={styles.checkIcon} aria-hidden>
        {icons[item.level]}
      </span>
      <div className={styles.checkBody}>
        <p className={styles.checkTitle} id={titleId}>
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
      {control != null && <div className={styles.checkAction}>{control}</div>}
    </li>
  );
}

/**
 * A plain-language security checkup. Problems come first, each with what it
 * means and one way to fix it — a button, or a command to copy when only a
 * person can; passed checks shrink to a quiet list so the good news never
 * drowns out a real warning.
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
          <Check key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

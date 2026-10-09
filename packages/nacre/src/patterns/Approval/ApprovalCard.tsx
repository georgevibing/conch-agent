import { Ban, Check, Clock, ShieldAlert, ShieldQuestion, type LucideIcon } from 'lucide-react';
import { createElement, type ComponentProps, type ReactNode, type Ref } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Approval.module.css';
import { ApprovalCommand } from './ApprovalCommand';

export type ApprovalDecision = 'allow' | 'allow-always' | 'deny';

export interface ApprovalCardProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** What will happen, short: "Edit your picture with Gemini on OpenRouter". */
  title: ReactNode;
  /** Where things go, in a few words: "Your picture goes to OpenRouter". */
  detail?: ReactNode;
  /** What it costs, when it costs money: "Paid", "Paid · about $0.04". Said first. */
  cost?: ReactNode;
  /**
   * Why to look twice, as one quiet line: "This chat read GitHub. Check this is
   * what you asked for." Never a box: it's a reason to read, not an alarm.
   */
  caution?: ReactNode;
  /** The command it would run, exactly: at code size, a few lines and then "Show all". */
  command?: string;
  /** What exactly it would do, when it isn't a command: a draft, an address. */
  children?: ReactNode;
  /** The mark beside the title. */
  icon?: LucideIcon;
  /** Offer "Always allow" (for the rest of the chat). */
  allowAlways?: boolean;
  allowLabel?: string;
  denyLabel?: string;
  alwaysLabel?: string;
  /** The answer on its way: the buttons wait, and the one pressed spins. */
  sent?: ApprovalDecision;
  onDecide?: (decision: ApprovalDecision) => void;
  /** The primary button, for focusing it when the card arrives. */
  allowRef?: Ref<HTMLButtonElement>;
}

/**
 * A question before something that matters (ADR 0028): what will happen as
 * its title, the facts in one quiet line, and the answer as one obvious
 * button. Allow leads; Always allow is beside it; Deny is quiet, and never
 * needs explaining. Once answered, the card goes: the tool's own row carries
 * the answer, or an `ApprovalLine` says it when there's no row.
 */
export function ApprovalCard({
  title,
  detail,
  cost,
  caution,
  command,
  children,
  icon = ShieldQuestion,
  allowAlways = true,
  allowLabel = 'Allow',
  denyLabel = 'Deny',
  alwaysLabel = 'Always allow',
  sent,
  onDecide,
  allowRef,
  className,
  ...props
}: ApprovalCardProps) {
  const busy = sent !== undefined;
  return (
    <div
      role="group"
      aria-label={typeof title === 'string' ? `Asks first: ${title}` : 'Asks first'}
      className={cx(styles.card, className)}
      data-lustre=""
      {...props}
    >
      <span className={styles.mark} aria-hidden>
        {createElement(icon)}
      </span>
      <div className={styles.body}>
        <div className={styles.text}>
          <p className={styles.title}>{title}</p>
          {(cost || detail) && (
            <p className={styles.facts}>
              {cost && <span className={styles.cost}>{cost}</span>}
              {cost && detail && (
                <span className={styles.dot} aria-hidden>
                  ·
                </span>
              )}
              {detail && <span>{detail}</span>}
            </p>
          )}
        </div>
        {command && <ApprovalCommand className={styles.command}>{command}</ApprovalCommand>}
        {children != null && <div className={styles.preview}>{children}</div>}
        {caution && (
          <p className={styles.caution}>
            <ShieldAlert aria-hidden />
            <span>{caution}</span>
          </p>
        )}
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            className={styles.deny}
            disabled={busy}
            loading={sent === 'deny'}
            onClick={() => onDecide?.('deny')}
          >
            {denyLabel}
          </Button>
          {allowAlways && (
            <Button
              size="sm"
              variant="surface"
              disabled={busy}
              loading={sent === 'allow-always'}
              onClick={() => onDecide?.('allow-always')}
            >
              {alwaysLabel}
            </Button>
          )}
          <Button
            ref={allowRef}
            size="sm"
            disabled={busy}
            loading={sent === 'allow'}
            onClick={() => onDecide?.('allow')}
          >
            {allowLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type ApprovalOutcome = 'allow' | 'allow-always' | 'deny' | 'expired';

export interface ApprovalLineProps extends Omit<ComponentProps<'p'>, 'children'> {
  decision: ApprovalOutcome;
  /** What it was about, short: the card's title. */
  children: ReactNode;
}

const OUTCOME: Record<ApprovalOutcome, { icon: LucideIcon; words: string }> = {
  allow: { icon: Check, words: 'Allowed' },
  'allow-always': { icon: Check, words: 'Always allowed' },
  deny: { icon: Ban, words: 'You said no' },
  expired: { icon: Clock, words: 'Not answered' },
};

/**
 * An answered question with no row of its own to carry it (Conch's own
 * tools that draw nothing): one quiet line. Saying no is neutral, never red.
 */
export function ApprovalLine({ decision, children, className, ...props }: ApprovalLineProps) {
  const { icon, words } = OUTCOME[decision];
  return (
    <p className={cx(styles.line, className)} data-decision={decision} {...props}>
      {createElement(icon, { 'aria-hidden': true })}
      <span>
        <span className={styles.lineWords}>{words}</span>
        <span aria-hidden> · </span>
        <span className={styles.lineAbout}>{children}</span>
      </span>
    </p>
  );
}

import { Check, Hand, PanelRight } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './Browser.module.css';

export interface BrowserHandoffProps extends ComponentProps<'div'> {
  /** What you need to do, in the assistant's words. */
  reason: string;
  state: 'waiting' | 'done' | 'cancelled';
  name?: string;
  /** Show the browser panel. */
  onShow?: () => void;
  /** You're done: hand the browser back. */
  onDone?: () => void;
}

/**
 * The assistant needs you for something only you should do — sign in, a
 * captcha, a payment — and waits. It never sees what you type there.
 */
export function BrowserHandoff({
  reason,
  state,
  name = 'Conch',
  onShow,
  onDone,
  className,
  ...props
}: BrowserHandoffProps) {
  if (state !== 'waiting') {
    return (
      <div
        role="note"
        className={cx(styles.approvalDone, className)}
        data-allowed={state === 'done' ? '' : undefined}
        {...props}
      >
        {state === 'done' ? <Check aria-hidden /> : <Hand aria-hidden />}
        <span>
          {state === 'done' ? 'You took care of it' : 'Stopped waiting'} · {reason}
        </span>
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label="Your turn in the browser"
      className={cx(styles.handoff, className)}
      data-lustre=""
      data-lustre-ambient=""
      {...props}
    >
      <Pearl size="md" state="streaming" label={null} />
      <div className={styles.handoffBody}>
        <p className={styles.handoffEyebrow}>Your turn</p>
        <p className={styles.handoffReason}>{reason}</p>
        <p className={styles.handoffNote}>{name} is waiting, and never sees what you type there.</p>
        <div className={styles.approvalActions}>
          {onShow && (
            <Button size="sm" variant="surface" leadingIcon={<PanelRight />} onClick={onShow}>
              Show the browser
            </Button>
          )}
          <Button size="sm" leadingIcon={<Check />} onClick={onDone}>
            I’m done
          </Button>
        </div>
      </div>
    </div>
  );
}

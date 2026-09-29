import { Receipt } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { describeUsage, headline } from './format';
import type { UsageValue } from './types';
import styles from './Usage.module.css';
import { UsageRing } from './UsageRing';
import { useNow } from './useNow';

export interface UsageMeterProps extends Omit<ComponentProps<'button'>, 'value' | 'children'> {
  value: UsageValue;
  /** Freeze the clock (stories/tests). Defaults to a live 30 s tick. */
  now?: number;
}

/**
 * The header fuel gauge: one ring and one number — what's left of the
 * tightest limit. Works as `Popover.Trigger asChild`.
 */
export function UsageMeter({ value, now, className, ...props }: UsageMeterProps) {
  const current = useNow(30_000, now);
  const head = headline(value);
  const unknown = value.kind === 'unknown';
  return (
    <button
      type="button"
      data-lustre=""
      data-kind={value.kind}
      data-severity={head.severity}
      aria-label={describeUsage(value, current)}
      className={cx(styles.meter, className)}
      {...props}
    >
      {value.kind === 'metered' && head.percentLeft === undefined ? (
        // Pay-as-you-go without a budget has nothing to run out of: no gauge, a receipt.
        <Receipt aria-hidden className={styles.meterIcon} />
      ) : (
        <UsageRing
          percentLeft={head.percentLeft}
          severity={head.severity}
          size={14}
          className={styles.meterRing}
        />
      )}
      {!unknown && <span className={styles.meterText}>{head.text}</span>}
    </button>
  );
}

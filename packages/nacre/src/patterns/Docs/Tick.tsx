import { Check, Minus } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Tick.module.css';

export interface TickProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Yes or no. */
  value: boolean;
  /** What it's read as. Defaults to "Yes" / "No". */
  label?: string;
}

/**
 * Yes or no, in a table of what things can do: a check, or a quiet dash. The
 * shape carries the answer, the colour only agrees with it, and a screen
 * reader hears the word.
 */
export function Tick({ value, label, className, ...props }: TickProps) {
  const Icon = value ? Check : Minus;
  return (
    <span data-value={value ? 'yes' : 'no'} className={cx(styles.tick, className)} {...props}>
      <Icon aria-hidden strokeWidth={2.5} />
      <span className="nc-visually-hidden">{label ?? (value ? 'Yes' : 'No')}</span>
    </span>
  );
}

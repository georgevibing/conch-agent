import type { ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './ChoiceRow.module.css';

export interface ChoiceRowProps {
  control: ReactNode;
  controlId: string;
  label?: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  disabled?: boolean;
  /** Put the control after the text (settings rows). */
  controlPosition?: 'start' | 'end';
  className?: string;
}

/**
 * Internal layout for checkbox / switch / radio rows: control + label +
 * optional description, correctly associated.
 */
export function ChoiceRow({
  control,
  controlId,
  label,
  description,
  descriptionId,
  disabled,
  controlPosition = 'start',
  className,
}: ChoiceRowProps) {
  return (
    <div
      data-disabled={disabled || undefined}
      data-control-position={controlPosition}
      className={cx(styles.row, className)}
    >
      <span className={styles.control}>{control}</span>
      <span className={styles.text}>
        <label htmlFor={controlId} className={styles.label}>
          {label}
        </label>
        {description != null && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </div>
  );
}

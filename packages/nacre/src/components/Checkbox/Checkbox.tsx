import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import { ChoiceRow } from '../Field/ChoiceRow';
import styles from './Checkbox.module.css';

export type CheckedState = boolean | 'indeterminate';

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  size?: 'sm' | 'md';
  /** Renders an associated label next to the box. */
  label?: ReactNode;
  description?: ReactNode;
  invalid?: boolean;
}

/**
 * Checkbox whose tick draws itself in with a small spring. Supports
 * `checked="indeterminate"`.
 */
export function Checkbox({
  size = 'md',
  label,
  description,
  invalid: invalidProp,
  className,
  id: idProp,
  ...props
}: CheckboxProps) {
  const autoId = useId();
  const {
    invalid,
    labelId: _labelId,
    ...field
  } = useFieldControl({
    ...props,
    id: idProp,
    invalid: invalidProp,
  });
  const id = field.id ?? autoId;
  const descriptionId = `${id}-description`;
  const describedBy =
    [field['aria-describedby'], description != null ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  const control = (
    <CheckboxPrimitive.Root
      data-size={size}
      data-invalid={invalid || undefined}
      className={cx(styles.box, label == null && className)}
      {...props}
      {...field}
      id={id}
      aria-describedby={describedBy}
    >
      <CheckboxPrimitive.Indicator forceMount className={styles.indicator}>
        <svg viewBox="0 0 16 16" aria-hidden className={styles.glyph}>
          <path className={styles.check} d="M3.75 8.4 6.6 11.1 12.25 5.25" pathLength={1} />
          <path className={styles.dash} d="M4.25 8h7.5" pathLength={1} />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (label == null) return control;
  return (
    <ChoiceRow
      control={control}
      controlId={id}
      label={label}
      description={description}
      descriptionId={descriptionId}
      disabled={field.disabled}
      className={className}
    />
  );
}

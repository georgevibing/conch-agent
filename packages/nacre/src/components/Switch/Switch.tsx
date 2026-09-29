import { Switch as SwitchPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import { ChoiceRow } from '../Field/ChoiceRow';
import styles from './Switch.module.css';

export interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  size?: 'sm' | 'md';
  label?: ReactNode;
  description?: ReactNode;
  /** `end` puts the switch after the label, as in a settings list. */
  labelPosition?: 'end' | 'start';
}

/** On/off toggle. The thumb stretches while pressed and springs into place. */
export function Switch({
  size = 'md',
  label,
  description,
  labelPosition = 'end',
  className,
  id: idProp,
  ...props
}: SwitchProps) {
  const autoId = useId();
  const {
    invalid: _invalid,
    labelId: _labelId,
    ...field
  } = useFieldControl({ ...props, id: idProp });
  const id = field.id ?? autoId;
  const descriptionId = `${id}-description`;
  const describedBy =
    [field['aria-describedby'], description != null ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  const control = (
    <SwitchPrimitive.Root
      data-size={size}
      className={cx(styles.track, label == null && className)}
      {...props}
      {...field}
      id={id}
      aria-describedby={describedBy}
    >
      <SwitchPrimitive.Thumb className={styles.thumb} />
    </SwitchPrimitive.Root>
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
      controlPosition={labelPosition === 'start' ? 'end' : 'start'}
      className={className}
    />
  );
}

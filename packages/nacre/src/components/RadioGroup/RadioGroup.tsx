import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import { ChoiceRow } from '../Field/ChoiceRow';
import styles from './RadioGroup.module.css';

type RadioVariant = 'default' | 'card';

const RadioVariantContext = createContext<RadioVariant>('default');

export interface RadioGroupProps extends ComponentProps<typeof RadioPrimitive.Root> {
  /** `card` renders each option as a selectable tile. */
  variant?: RadioVariant;
  /** Layout of the options. Also sets arrow-key orientation. */
  orientation?: 'vertical' | 'horizontal';
}

function RadioGroupRoot({
  variant = 'default',
  orientation = 'vertical',
  className,
  ...props
}: RadioGroupProps) {
  const { invalid, labelId, id: _id, ...field } = useFieldControl(props);
  return (
    <RadioVariantContext.Provider value={variant}>
      <RadioPrimitive.Root
        orientation={orientation}
        data-variant={variant}
        data-invalid={invalid || undefined}
        aria-labelledby={props['aria-labelledby'] ?? (props['aria-label'] ? undefined : labelId)}
        className={cx(styles.group, className)}
        {...props}
        {...field}
      />
    </RadioVariantContext.Provider>
  );
}

export interface RadioGroupItemProps extends Omit<
  ComponentProps<typeof RadioPrimitive.Item>,
  'children'
> {
  label: ReactNode;
  description?: ReactNode;
  /** Card variant only: leading visual (icon, avatar). */
  icon?: ReactNode;
}

function RadioGroupItem({
  label,
  description,
  icon,
  className,
  id: idProp,
  ...props
}: RadioGroupItemProps) {
  const variant = useContext(RadioVariantContext);
  const autoId = useId();
  const id = idProp ?? autoId;
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  if (variant === 'card') {
    return (
      <RadioPrimitive.Item
        id={id}
        data-lustre=""
        aria-labelledby={labelId}
        aria-describedby={description != null ? descriptionId : undefined}
        className={cx(styles.card, className)}
        {...props}
      >
        {icon != null && (
          <span className={styles.cardIcon} aria-hidden>
            {icon}
          </span>
        )}
        <span className={styles.cardText}>
          <span id={labelId} className={styles.cardLabel}>
            {label}
          </span>
          {description != null && (
            <span id={descriptionId} className={styles.cardDescription}>
              {description}
            </span>
          )}
        </span>
        <span className={styles.radio} aria-hidden>
          <RadioPrimitive.Indicator forceMount className={styles.dot} />
        </span>
      </RadioPrimitive.Item>
    );
  }

  return (
    <ChoiceRow
      controlId={id}
      label={label}
      description={description}
      descriptionId={descriptionId}
      disabled={props.disabled}
      className={className}
      control={
        <RadioPrimitive.Item
          id={id}
          aria-describedby={description != null ? descriptionId : undefined}
          className={styles.radio}
          {...props}
        >
          <RadioPrimitive.Indicator forceMount className={styles.dot} />
        </RadioPrimitive.Item>
      }
    />
  );
}

/** Single choice from a small set. Arrow keys move between options. */
export const RadioGroup = Object.assign(RadioGroupRoot, {
  Root: RadioGroupRoot,
  Item: RadioGroupItem,
});

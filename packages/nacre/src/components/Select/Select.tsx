import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import styles from './Select.module.css';

export interface SelectProps extends Omit<ComponentProps<typeof SelectPrimitive.Root>, 'children'> {
  children: ReactNode;
  placeholder?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * - `field`   recessed well matching Input (forms)
   * - `surface` raised porcelain button (toolbars, pickers)
   * - `ghost`   borderless, for dense chrome
   */
  variant?: 'field' | 'surface' | 'ghost';
  /** Icon shown before the value in the trigger. */
  leading?: ReactNode;
  invalid?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** Align the menu with the trigger edge instead of centring the value. */
  align?: 'start' | 'center' | 'end';
}

/**
 * Single-value picker built on Radix Select: full keyboard support,
 * typeahead, and a menu that surfaces with Nacre's signature entrance.
 */
function SelectRoot({
  children,
  placeholder = 'Select…',
  size = 'md',
  variant = 'field',
  leading,
  invalid: invalidProp,
  id,
  className,
  contentClassName,
  align = 'start',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  disabled: disabledProp,
  required: requiredProp,
  ...props
}: SelectProps) {
  const {
    invalid,
    labelId: _labelId,
    ...field
  } = useFieldControl({
    id,
    invalid: invalidProp,
    disabled: disabledProp,
    required: requiredProp,
    'aria-describedby': ariaDescribedBy,
  });
  return (
    <SelectPrimitive.Root disabled={field.disabled} required={field.required} {...props}>
      <SelectPrimitive.Trigger
        id={field.id}
        data-size={size}
        data-variant={variant}
        data-invalid={invalid || undefined}
        data-lustre={variant === 'surface' ? '' : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={field['aria-describedby']}
        aria-invalid={field['aria-invalid']}
        className={cx(styles.trigger, className)}
      >
        {leading != null && (
          <span className={styles.leading} aria-hidden>
            {leading}
          </span>
        )}
        <span className={styles.value}>
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon className={styles.chevron}>
          <ChevronDown aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          align={align}
          collisionPadding={8}
          className={cx(styles.content, contentClassName)}
        >
          <SelectPrimitive.ScrollUpButton className={styles.scroll}>
            <ChevronUp aria-hidden />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className={styles.viewport}>
            {children}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className={styles.scroll}>
            <ChevronDown aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export interface SelectItemProps extends ComponentProps<typeof SelectPrimitive.Item> {
  /** Secondary line shown in the menu only (not in the trigger). */
  description?: ReactNode;
  icon?: ReactNode;
}

function SelectItem({ children, description, icon, className, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item className={cx(styles.item, className)} {...props}>
      {icon != null && (
        <span className={styles.itemIcon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={styles.itemText}>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description != null && <span className={styles.itemDescription}>{description}</span>}
      </span>
      <SelectPrimitive.ItemIndicator className={styles.indicator}>
        <Check aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export interface SelectGroupProps extends ComponentProps<typeof SelectPrimitive.Group> {
  label?: ReactNode;
}

function SelectGroup({ label, children, className, ...props }: SelectGroupProps) {
  return (
    <SelectPrimitive.Group className={cx(styles.group, className)} {...props}>
      {label != null && (
        <SelectPrimitive.Label className={styles.groupLabel}>{label}</SelectPrimitive.Label>
      )}
      {children}
    </SelectPrimitive.Group>
  );
}

function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

export const Select = Object.assign(SelectRoot, {
  Item: SelectItem,
  Group: SelectGroup,
  Separator: SelectSeparator,
});

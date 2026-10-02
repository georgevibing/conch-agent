import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Spinner } from '../Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'solid' | 'soft' | 'surface' | 'ghost';
export type ButtonTone = 'accent' | 'neutral' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Icon rendered before the label. Replaced by a spinner while `loading`. */
  leadingIcon?: ReactNode;
  /** Icon rendered after the label. */
  trailingIcon?: ReactNode;
  /**
   * Something after the label that isn't an icon and keeps its own size: a
   * count, a key hint. In a button wider than its words it sits at the far
   * end. Like the icons it isn't read aloud, so say what it means in the label.
   */
  trailing?: ReactNode;
  /** Shows a spinner, sets `aria-busy` and blocks activation without collapsing width. */
  loading?: boolean;
  /** Stretch to the width of the container. */
  block?: boolean;
  /** Render the child element (e.g. a router `<Link>`) with button styling. */
  asChild?: boolean;
}

export function Button({
  variant = 'solid',
  tone,
  size = 'md',
  leadingIcon,
  trailingIcon,
  trailing,
  loading = false,
  block = false,
  asChild = false,
  disabled,
  className,
  children,
  type,
  onClick,
  ...props
}: ButtonProps) {
  const resolvedTone = tone ?? (variant === 'solid' || variant === 'soft' ? 'accent' : 'neutral');
  const Comp = asChild ? Slot.Root : 'button';
  const lead = loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} label={null} /> : leadingIcon;

  return (
    <Comp
      data-lustre=""
      data-variant={variant}
      data-tone={resolvedTone}
      data-size={size}
      data-loading={loading || undefined}
      data-block={block || undefined}
      data-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      disabled={disabled}
      type={asChild ? undefined : (type ?? 'button')}
      className={cx(styles.button, className)}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...props}
    >
      {lead != null && (
        <span className={styles.icon} aria-hidden>
          {lead}
        </span>
      )}
      {asChild ? (
        // The child is the element; what's inside it is the label, between the icons.
        <Slot.Slottable>{children}</Slot.Slottable>
      ) : (
        children != null && <span className={styles.label}>{children}</span>
      )}
      {trailingIcon != null && (
        <span className={styles.icon} aria-hidden>
          {trailingIcon}
        </span>
      )}
      {trailing != null && (
        <span className={styles.trailing} aria-hidden>
          {trailing}
        </span>
      )}
    </Comp>
  );
}

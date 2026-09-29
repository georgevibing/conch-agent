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
      {asChild ? (
        children
      ) : (
        <>
          {lead != null && (
            <span className={styles.icon} aria-hidden>
              {lead}
            </span>
          )}
          {children != null && <span className={styles.label}>{children}</span>}
          {trailingIcon != null && (
            <span className={styles.icon} aria-hidden>
              {trailingIcon}
            </span>
          )}
        </>
      )}
    </Comp>
  );
}

import { Slot } from 'radix-ui';
import type { ComponentProps, ElementType } from 'react';

import { cx } from '../../utils/cx';
import styles from './Surface.module.css';

export interface SurfaceProps extends ComponentProps<'div'> {
  /**
   * - `raised`  glazed porcelain with layered shadow (default)
   * - `flat`    same material, no shadow
   * - `sunken`  recessed well, e.g. behind inputs or code
   * - `outline` transparent with a hairline border
   */
  variant?: 'raised' | 'flat' | 'sunken' | 'outline';
  elevation?: 0 | 1 | 2 | 3 | 4;
  /** Enable the Lustre pearl rim + sheen. `ambient` makes the rim orbit slowly. */
  lustre?: boolean | 'ambient';
  /** Hover/press affordances for clickable surfaces. */
  interactive?: boolean;
  radius?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  padding?: 0 | 2 | 3 | 4 | 5 | 6 | 8;
  as?: 'div' | 'section' | 'article' | 'aside' | 'li' | 'header' | 'footer';
  asChild?: boolean;
}

/** The base material every container in Nacre is made of. */
export function Surface({
  variant = 'raised',
  elevation,
  lustre = false,
  interactive = false,
  radius = 'lg',
  padding,
  as = 'div',
  asChild,
  className,
  style,
  ...props
}: SurfaceProps) {
  const Comp: ElementType = asChild ? Slot.Root : as;
  return (
    <Comp
      data-variant={variant}
      data-elevation={elevation ?? (variant === 'raised' ? 2 : 0)}
      data-interactive={interactive || undefined}
      data-lustre={lustre ? '' : undefined}
      data-lustre-ambient={lustre === 'ambient' ? '' : undefined}
      className={cx(styles.surface, className)}
      style={{
        borderRadius: `var(--nc-radius-${radius})`,
        padding: padding !== undefined ? `var(--nc-space-${padding})` : undefined,
        ...style,
      }}
      {...props}
    />
  );
}

export interface CardProps extends SurfaceProps {
  /** Adds the standard card padding and vertical rhythm. */
  inset?: boolean;
}

function CardRoot({ inset = true, className, ...props }: CardProps) {
  return (
    <Surface lustre className={cx(styles.card, inset && styles.cardInset, className)} {...props} />
  );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.cardHeader, className)} {...props} />;
}

function CardTitle({ className, children, ...props }: ComponentProps<'h3'>) {
  return (
    <h3 className={cx(styles.cardTitle, className)} {...props}>
      {children}
    </h3>
  );
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cx(styles.cardDescription, className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.cardFooter, className)} {...props} />;
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Footer: CardFooter,
});

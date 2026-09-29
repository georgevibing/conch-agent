import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Heading } from '../Text';
import styles from './EmptyState.module.css';

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Icon or illustration. Icons get a glazed pearl tile; pass `media` for full illustrations. */
  icon?: ReactNode;
  /** Free-form illustration rendered as-is (takes precedence over `icon`). */
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary / secondary actions. */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Heading level for the title so it fits the page outline. */
  headingLevel?: 2 | 3 | 4;
}

/** A calm, editorial moment for "nothing here yet" and first-run screens. */
export function EmptyState({
  icon,
  media,
  title,
  description,
  actions,
  size = 'md',
  headingLevel = 2,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div data-size={size} className={cx(styles.empty, className)} {...props}>
      {media ??
        (icon != null && (
          <div className={styles.tile} data-lustre="" aria-hidden>
            {icon}
          </div>
        ))}
      <div className={styles.text}>
        <Heading
          level={headingLevel}
          display
          size={size === 'lg' ? '4xl' : size === 'sm' ? '2xl' : '3xl'}
          align="center"
        >
          {title}
        </Heading>
        {description != null && <p className={styles.description}>{description}</p>}
      </div>
      {actions != null && <div className={styles.actions}>{actions}</div>}
      {children}
    </div>
  );
}

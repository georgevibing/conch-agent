import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './Skeleton.module.css';

export interface SkeletonProps extends ComponentProps<'span'> {
  /** `text` matches line height; `circle` for avatars; `block` for arbitrary shapes. */
  shape?: 'text' | 'block' | 'circle';
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  /** Number of text lines; the last line is shortened for a natural rag. */
  lines?: number;
  /** When `false`, renders children instead of the placeholder. */
  loading?: boolean;
}

/**
 * Loading placeholder with a slow pearl shimmer. Hidden from assistive tech —
 * announce loading state on the container (e.g. `aria-busy`) instead.
 */
export function Skeleton({
  shape = 'text',
  width,
  height,
  lines = 1,
  loading = true,
  className,
  style,
  children,
  ...props
}: SkeletonProps) {
  if (!loading) return <>{children}</>;
  if (shape === 'text' && lines > 1) {
    return (
      <span
        className={cx(styles.lines, className)}
        style={{ width, ...style }}
        aria-hidden
        {...props}
      >
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            data-shape="text"
            className={styles.skeleton}
            style={{ width: i === lines - 1 ? '62%' : '100%' }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-shape={shape}
      className={cx(styles.skeleton, className)}
      style={{ width, height: shape === 'circle' ? (height ?? width) : height, ...style }}
      {...props}
    />
  );
}

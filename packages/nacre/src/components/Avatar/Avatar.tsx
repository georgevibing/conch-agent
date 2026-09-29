import { Avatar as AvatarPrimitive } from 'radix-ui';
import { Children, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarStatus = 'online' | 'busy' | 'offline' | 'working';

export interface AvatarProps extends Omit<ComponentProps<typeof AvatarPrimitive.Root>, 'children'> {
  /** Person or agent name — used for alt text, initials and the fallback tint. */
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: 'circle' | 'square';
  status?: AvatarStatus;
  /** Custom fallback content (e.g. an icon or the Pearl) instead of initials. */
  fallback?: ReactNode;
}

const statusLabel: Record<AvatarStatus, string> = {
  online: 'Online',
  busy: 'Busy',
  offline: 'Offline',
  working: 'Working',
};

/** Stable hue from a string (FNV-1a), so a name always gets the same tint. */
export function hueFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  status,
  fallback,
  className,
  style,
  ...props
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-size={size}
      data-shape={shape}
      className={cx(styles.avatar, className)}
      style={{ '--avatar-h': hueFromString(name), ...style } as CSSProperties}
      role="img"
      aria-label={status ? `${name} (${statusLabel[status]})` : name}
      {...props}
    >
      {src && <AvatarPrimitive.Image className={styles.image} src={src} alt="" />}
      <AvatarPrimitive.Fallback className={styles.fallback} delayMs={src ? 400 : undefined}>
        {fallback ?? <span aria-hidden>{initialsOf(name)}</span>}
      </AvatarPrimitive.Fallback>
      {status && <span className={styles.status} data-status={status} aria-hidden />}
    </AvatarPrimitive.Root>
  );
}

export interface AvatarGroupProps extends ComponentProps<'div'> {
  /** Show at most this many avatars, then a "+N" chip. */
  max?: number;
  size?: AvatarSize;
}

/** Overlapping stack of avatars. Children should be `<Avatar>` elements. */
export function AvatarGroup({
  max = 4,
  size = 'md',
  className,
  children,
  ...props
}: AvatarGroupProps) {
  const items = Children.toArray(children);
  const visible = items.slice(0, max);
  const overflow = items.length - visible.length;
  return (
    <div role="group" data-size={size} className={cx(styles.group, className)} {...props}>
      {visible}
      {overflow > 0 && (
        <span
          className={cx(styles.avatar, styles.overflow)}
          data-size={size}
          data-shape="circle"
          role="img"
          aria-label={`${overflow} more`}
        >
          <span aria-hidden>+{overflow}</span>
        </span>
      )}
    </div>
  );
}

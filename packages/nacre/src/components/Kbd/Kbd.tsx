import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Kbd.module.css';

const symbols: Record<string, string> = {
  mod:
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl',
  cmd: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  enter: '↵',
  return: '↵',
  esc: 'Esc',
  escape: 'Esc',
  tab: '⇥',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  backspace: '⌫',
  space: 'Space',
};

export interface KbdProps extends Omit<ComponentProps<'kbd'>, 'children'> {
  /** A key or chord, e.g. `"mod+k"`, `["shift", "enter"]`. Named keys render as symbols. */
  keys: string | string[];
  size?: 'sm' | 'md';
  /** Render on dark/inverse surfaces (e.g. inside a Tooltip). */
  inverse?: boolean;
}

export function formatKey(key: string): string {
  const k = key.trim().toLowerCase();
  return symbols[k] ?? (k.length === 1 ? k.toUpperCase() : key);
}

/** Keyboard shortcut hint. Renders nested `<kbd>` elements per the HTML spec. */
export function Kbd({ keys, size = 'md', inverse, className, ...props }: KbdProps) {
  const list = Array.isArray(keys) ? keys : keys.split('+');
  return (
    <kbd
      data-size={size}
      data-inverse={inverse || undefined}
      className={cx(styles.kbd, className)}
      {...props}
    >
      {list.map((key, i) => (
        <kbd key={`${key}-${i}`} className={styles.key}>
          {formatKey(key)}
        </kbd>
      ))}
    </kbd>
  );
}

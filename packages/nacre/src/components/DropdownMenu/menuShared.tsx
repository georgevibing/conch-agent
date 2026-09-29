import { Check, ChevronRight } from 'lucide-react';
import { useCallback, useRef, type FocusEvent, type ReactNode } from 'react';

import { Kbd } from '../Kbd';
import styles from './menu.module.css';

export { styles as menuStyles };

const ITEM_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'menuitemradio']);

/**
 * Drives the single gliding highlight wash of a menu. Radix moves DOM focus to
 * the highlighted item for both pointer and keyboard, so following `focusin`
 * covers every input method.
 */
export function useMenuGlide() {
  const glideRef = useRef<HTMLSpanElement>(null);

  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const glide = glideRef.current;
    const item = event.target;
    if (!glide) return;
    if (
      !ITEM_ROLES.has(item.getAttribute('role') ?? '') ||
      item.closest('[role="menu"]') !== event.currentTarget
    ) {
      if (item === event.currentTarget) glide.removeAttribute('data-visible');
      return;
    }
    const wasVisible = glide.hasAttribute('data-visible');
    if (!wasVisible) glide.style.transition = 'none';
    glide.style.setProperty('--glide-y', `${item.offsetTop}px`);
    glide.style.setProperty('--glide-h', `${item.offsetHeight}px`);
    glide.dataset.tone = item.dataset.tone ?? '';
    glide.setAttribute('data-visible', '');
    if (!wasVisible) {
      void glide.offsetWidth;
      glide.style.transition = '';
    }
  }, []);

  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next))
      glideRef.current?.removeAttribute('data-visible');
  }, []);

  const glide = <span ref={glideRef} className={styles.glide} aria-hidden />;
  return { glide, onFocus, onBlur };
}

export interface MenuItemSlotsProps {
  /** Leading icon. */
  icon?: ReactNode;
  /** Keyboard shortcut hint, e.g. `"mod+shift+n"`. Purely visual. */
  shortcut?: string | string[];
  /** Arbitrary trailing content (count, badge, hint). */
  trailing?: ReactNode;
  /** Reserve the icon column when this item has no icon, to align labels. */
  inset?: boolean;
  children?: ReactNode;
}

export function ItemSlots({ icon, shortcut, trailing, children }: MenuItemSlotsProps) {
  return (
    <>
      {icon != null && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {(shortcut || trailing != null) && (
        <span className={styles.trailing}>
          {trailing}
          {shortcut && <Kbd keys={shortcut} size="sm" aria-hidden />}
        </span>
      )}
    </>
  );
}

export function CheckIndicator() {
  return <Check />;
}

export function RadioDot() {
  return <span className={styles.dot} />;
}

export function SubChevron() {
  return <ChevronRight className={styles.chevron} aria-hidden />;
}

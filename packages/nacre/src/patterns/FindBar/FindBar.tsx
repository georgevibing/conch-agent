import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './FindBar.module.css';

export interface FindBarProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  query: string;
  onQueryChange: (query: string) => void;
  /** Matches found. */
  count: number;
  /** Index of the current match, or -1. */
  current: number;
  /** More matches than were counted. */
  capped?: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  placeholder?: string;
  /** Accessible name of the search field. */
  label?: string;
  /** Focus and select the field on mount (and whenever this changes). */
  focusKey?: unknown;
}

/**
 * Find in this conversation: a small floating pill. Type to highlight every
 * match; ↵ / ⇧↵ (or ↓ / ↑) move between them; Esc closes. The counter is
 * announced politely so screen-reader users hear "3 of 17".
 */
export function FindBar({
  query,
  onQueryChange,
  count,
  current,
  capped = false,
  onNext,
  onPrev,
  onClose,
  placeholder = 'Find in chat',
  label = 'Find in this conversation',
  focusKey,
  className,
  ...props
}: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)) onPrev();
      else onNext();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const hasQuery = query.trim().length > 0;
  const none = hasQuery && count === 0;
  const status = !hasQuery
    ? ''
    : none
      ? 'No matches'
      : `${current + 1} of ${count}${capped ? '+' : ''}`;

  return (
    <div
      role="search"
      data-lustre=""
      data-empty={none || undefined}
      data-find-skip=""
      className={cx(styles.bar, className)}
      {...props}
    >
      <Search className={styles.icon} aria-hidden />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={none || undefined}
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="search"
        className={styles.input}
      />
      <span className={styles.count} role="status" aria-live="polite" aria-atomic>
        {status}
      </span>
      <span className={styles.divider} aria-hidden />
      <IconButton
        size="sm"
        label="Previous match"
        shortcut="shift+enter"
        onClick={onPrev}
        disabled={count === 0}
      >
        <ChevronUp />
      </IconButton>
      <IconButton
        size="sm"
        label="Next match"
        shortcut="enter"
        onClick={onNext}
        disabled={count === 0}
      >
        <ChevronDown />
      </IconButton>
      <IconButton size="sm" label="Close find" shortcut="esc" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );
}

export interface FindRailProps extends ComponentProps<'div'> {
  /** Match positions, 0–1 down the scrolled content. */
  positions: number[];
  /** Index (into `positions`) of the current match, or -1. */
  current?: number;
}

/**
 * Tick marks along the scrollbar showing where matches are in the whole
 * conversation — the shape of your search at a glance. Decorative: the
 * FindBar carries the same information for assistive tech.
 */
export function FindRail({ positions, current = -1, className, ...props }: FindRailProps) {
  if (!positions.length) return null;
  return (
    <div aria-hidden className={cx(styles.rail, className)} {...props}>
      {positions.map((p, i) => (
        <span
          key={i}
          className={styles.tick}
          data-current={i === current || undefined}
          style={{ '--tick-y': p } as CSSProperties}
        />
      ))}
    </div>
  );
}

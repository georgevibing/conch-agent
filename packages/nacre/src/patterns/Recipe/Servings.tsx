import { Minus, Plus } from 'lucide-react';
import { useState, type CSSProperties } from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { unitFor } from './amounts';
import styles from './Recipe.module.css';

/**
 * A number that rolls to its new value: the old one slides out, the new one
 * in, up when it grew and down when it shrank. Only a change moves it; it
 * arrives still. `delay` staggers a column of them.
 */
export function RollNumber({
  value,
  order,
  index = 0,
  className,
}: {
  /** What's shown. */
  value: string;
  /** Which way it went: a number that grows rolls up. */
  order: number;
  index?: number;
  className?: string;
}) {
  const [last, setLast] = useState({ value, order, dir: '' as '' | 'up' | 'down' });
  let dir = last.dir;
  if (last.value !== value) {
    dir = order >= last.order ? 'up' : 'down';
    setLast({ value, order, dir });
  }
  return (
    <span className={cx(styles.roll, className)}>
      <span
        key={value}
        className={styles.rollValue}
        data-dir={dir || undefined}
        style={{ '--rc-i': index } as CSSProperties}
      >
        {value}
      </span>
    </span>
  );
}

export interface ServingsStepperProps {
  value: number;
  onChange: (value: number) => void;
  /** What a serving is called: `servings`, `cookies`; none for a multiplier (`2×`). */
  unit?: string;
  min?: number;
  max?: number;
  size?: 'md' | 'lg';
  className?: string;
}

/** `4 servings`, `1 loaf`, `2×`. */
export function servingsWords(value: number, unit?: string): string {
  if (!unit) return `${value}×`;
  const agreed = unitFor(unit, value);
  if (value === 1 && agreed === unit && /[^s]s$/.test(unit))
    return `1 ${unit.replace(/ies$/, 'y').replace(/s$/, '')}`;
  return `${value} ${agreed}`;
}

/**
 * − and + round how many it's for. Every amount in the recipe follows,
 * rolling to its new number.
 */
export function ServingsStepper({
  value,
  onChange,
  unit,
  min = 1,
  max = 99,
  size = 'md',
  className,
}: ServingsStepperProps) {
  const words = servingsWords(value, unit);
  const [count, ...rest] = words.split(' ');
  return (
    <div
      role="group"
      aria-label="How many it makes"
      className={cx(styles.stepper, className)}
      data-size={size}
    >
      <IconButton
        label={unit ? `Fewer ${unit}` : 'Make less'}
        tooltip={false}
        size={size === 'lg' ? 'lg' : 'sm'}
        variant="surface"
        shape="circle"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus />
      </IconButton>
      <output className={styles.stepperValue} aria-live="polite" aria-atomic>
        <RollNumber value={count ?? String(value)} order={value} />
        {rest.length > 0 && <span className={styles.stepperUnit}> {rest.join(' ')}</span>}
      </output>
      <IconButton
        label={unit ? `More ${unit}` : 'Make more'}
        tooltip={false}
        size={size === 'lg' ? 'lg' : 'sm'}
        variant="surface"
        shape="circle"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus />
      </IconButton>
    </div>
  );
}

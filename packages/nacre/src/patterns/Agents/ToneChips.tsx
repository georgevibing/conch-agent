import { RadioGroup as RadioPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Agents.module.css';

export interface ToneChoice {
  value: string;
  label: string;
  /** A few words on how it sounds: said under the chips for the one chosen. */
  description?: string;
}

export interface ToneChipsProps extends Omit<
  ComponentProps<typeof RadioPrimitive.Root>,
  'children' | 'value' | 'onValueChange' | 'defaultValue'
> {
  choices: readonly ToneChoice[];
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * How an agent sounds, as a row of chips: one press each, the arrow keys
 * walk them, and the chosen one's few words sit quietly underneath.
 */
export function ToneChips({ choices, value, onValueChange, className, ...props }: ToneChipsProps) {
  const chosen = choices.find((choice) => choice.value === value);
  return (
    <div className={cx(styles.tones, className)}>
      <RadioPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        orientation="horizontal"
        loop
        className={styles.toneRow}
        {...props}
      >
        {choices.map((choice) => (
          <RadioPrimitive.Item
            key={choice.value}
            value={choice.value}
            className={styles.tone}
            data-lustre
            aria-description={choice.description}
          >
            {choice.label}
          </RadioPrimitive.Item>
        ))}
      </RadioPrimitive.Root>
      {chosen?.description && (
        <p className={styles.toneSays} aria-hidden>
          {chosen.description}
        </p>
      )}
    </div>
  );
}

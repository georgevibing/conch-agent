import { Slider as SliderPrimitive } from 'radix-ui';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import styles from './Slider.module.css';

export interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  size?: 'sm' | 'md';
  /**
   * Show the value in a bubble above the thumb: `hover` (while hovered,
   * focused or dragged) or `always`.
   */
  showValue?: 'hover' | 'always' | false;
  formatValue?: (value: number) => ReactNode;
  /** Accessible label(s) for thumbs, in order. Falls back to the Field label. */
  thumbLabels?: string[];
  /** Human-readable value for assistive tech, e.g. `"16 thousand tokens"`. */
  getValueText?: (value: number) => string;
}

/** Continuous or stepped range input. Supports multiple thumbs. */
export function Slider({
  size = 'md',
  showValue = false,
  formatValue = (v) => v,
  thumbLabels,
  getValueText,
  className,
  value: valueProp,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  'aria-label': ariaLabel,
  ...props
}: SliderProps) {
  const { invalid: _invalid, labelId, id, ...field } = useFieldControl(props);
  const [internal, setInternal] = useState<number[]>(defaultValue ?? [min]);
  const value = valueProp ?? internal;

  return (
    <SliderPrimitive.Root
      data-size={size}
      data-show-value={showValue || undefined}
      className={cx(styles.root, className)}
      value={value}
      min={min}
      max={max}
      onValueChange={(next) => {
        if (valueProp === undefined) setInternal(next);
        onValueChange?.(next);
      }}
      {...props}
      disabled={field.disabled}
    >
      <SliderPrimitive.Track className={styles.track}>
        <SliderPrimitive.Range className={styles.range} />
      </SliderPrimitive.Track>
      {value.map((v, i) => (
        <SliderPrimitive.Thumb
          // Thumbs are positional; index is the stable identity here.
          key={i}
          id={i === 0 ? id : undefined}
          aria-label={thumbLabels?.[i] ?? (labelId ? undefined : ariaLabel)}
          aria-labelledby={thumbLabels?.[i] || ariaLabel || !labelId ? undefined : labelId}
          aria-describedby={field['aria-describedby']}
          aria-valuetext={getValueText?.(v)}
          className={styles.thumb}
        >
          {showValue && (
            <span className={styles.bubble} aria-hidden>
              {formatValue(v)}
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  );
}

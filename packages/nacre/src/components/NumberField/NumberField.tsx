import { Minus, Plus } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import inputStyles from '../Input/Input.module.css';
import styles from './NumberField.module.css';

export interface NumberFieldProps extends Omit<
  ComponentProps<'input'>,
  'size' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'type'
> {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  /** Arrow keys and the buttons move by this much; Page Up/Down by ten times it. */
  step?: number;
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  /** Unit shown after the number, inside the well (e.g. "min"). */
  unit?: ReactNode;
  /** Accessible names for the buttons. */
  decrementLabel?: string;
  incrementLabel?: string;
  rootClassName?: string;
}

const HOLD_DELAY = 380;
const HOLD_RATE = 70;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * A number in a well, flanked by − and + that you can press and hold. Arrow
 * keys step, Page Up/Down leap, Home/End jump to the limits. Typing is free —
 * the value settles into range when you leave the field or press Enter.
 */
export function NumberField({
  value: valueProp,
  defaultValue = 0,
  onValueChange,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  size = 'md',
  invalid: invalidProp,
  unit,
  decrementLabel = 'Decrease',
  incrementLabel = 'Increase',
  disabled: disabledProp,
  className,
  rootClassName,
  onBlur,
  onKeyDown,
  onFocus,
  ref,
  ...props
}: NumberFieldProps) {
  const {
    invalid,
    disabled,
    labelId: _labelId,
    ...field
  } = useFieldControl({ ...props, invalid: invalidProp, disabled: disabledProp });
  const [internal, setInternal] = useState(defaultValue);
  const value = valueProp ?? internal;
  const [draft, setDraft] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; value: number }>({ value });
  useLayoutEffect(() => {
    hold.current.value = value;
  }, [value]);

  const commit = (next: number) => {
    const settled = clamp(next, min, max);
    if (settled !== value) {
      if (valueProp === undefined) setInternal(settled);
      onValueChange?.(settled);
    }
    return settled;
  };

  const nudge = (direction: 'up' | 'down') => {
    const el = inputRef.current;
    if (!el) return;
    delete el.dataset.nudge;
    void el.offsetWidth; // restart the animation
    el.dataset.nudge = direction;
  };

  const stepBy = (delta: number) => {
    setDraft(undefined);
    const from = hold.current.value;
    const next = commit(from + delta);
    hold.current.value = next;
    if (next !== from) nudge(delta > 0 ? 'up' : 'down');
    return next !== from;
  };

  const stopHold = () => clearTimeout(hold.current.timer);
  useEffect(() => stopHold, []);

  const startHold = (event: PointerEvent<HTMLButtonElement>, delta: number) => {
    if (event.button !== 0) return;
    event.preventDefault(); // keep focus (and the caret) in the input
    inputRef.current?.focus();
    if (!stepBy(delta)) return;
    const repeat = (wait: number) => {
      hold.current.timer = setTimeout(() => {
        if (stepBy(delta)) repeat(Math.max(HOLD_RATE * 0.5, wait * 0.9));
      }, wait);
    };
    stopHold();
    hold.current.timer = setTimeout(() => repeat(HOLD_RATE), HOLD_DELAY);
  };

  // Assistive tech and keyboard "clicks" (detail 0) don't send pointer events.
  const clickStep = (event: MouseEvent<HTMLButtonElement>, delta: number) => {
    if (event.detail === 0) stepBy(delta);
  };

  const settleDraft = () => {
    if (draft === undefined) return;
    const parsed = Number(draft);
    setDraft(undefined);
    if (draft.trim() !== '' && Number.isFinite(parsed)) commit(parsed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const keys: Record<string, () => void> = {
      ArrowUp: () => stepBy(step),
      ArrowDown: () => stepBy(-step),
      PageUp: () => stepBy(step * 10),
      PageDown: () => stepBy(-step * 10),
      Home: () => min > Number.MIN_SAFE_INTEGER && stepBy(min - value),
      End: () => max < Number.MAX_SAFE_INTEGER && stepBy(max - value),
      Enter: settleDraft,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const text = draft ?? String(value);

  return (
    <div
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={cx(inputStyles.well, styles.well, className, rootClassName)}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={decrementLabel}
        className={styles.step}
        disabled={disabled || value <= min}
        onPointerDown={(event) => startHold(event, -step)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onClick={(event) => clickStep(event, -step)}
      >
        <Minus aria-hidden />
      </button>
      <span className={styles.value}>
        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          type="text"
          role="spinbutton"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-valuenow={value}
          aria-valuemin={min > Number.MIN_SAFE_INTEGER ? min : undefined}
          aria-valuemax={max < Number.MAX_SAFE_INTEGER ? max : undefined}
          className={cx(inputStyles.input, styles.input)}
          style={{ '--nf-chars': Math.max(2, text.length) + 0.5 } as CSSProperties}
          value={text}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^\d.-]/g, '');
            setDraft(raw);
            const parsed = Number(raw);
            // Commit as you type only when it's already in range, so "1" on the
            // way to "15" isn't snapped up to a minimum of 15.
            if (raw !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
              if (parsed !== value) {
                if (valueProp === undefined) setInternal(parsed);
                onValueChange?.(parsed);
              }
            }
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            onFocus?.(event);
          }}
          onBlur={(event) => {
            settleDraft();
            onBlur?.(event);
          }}
          onKeyDown={handleKeyDown}
          {...props}
          {...field}
          disabled={disabled}
        />
        {unit != null && <span className={styles.unit}>{unit}</span>}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={incrementLabel}
        className={styles.step}
        disabled={disabled || value >= max}
        onPointerDown={(event) => startHold(event, step)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onClick={(event) => clickStep(event, step)}
      >
        <Plus aria-hidden />
      </button>
    </div>
  );
}

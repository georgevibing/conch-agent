import { X } from 'lucide-react';
import {
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
  type PointerEvent,
  type Ref,
} from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import styles from './Input.module.css';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: InputSize;
  /** Decorative icon or small control before the text. */
  leading?: ReactNode;
  /** Icon, unit, Kbd or IconButton after the text. */
  trailing?: ReactNode;
  invalid?: boolean;
  /** Show a clear button while the input has a value. */
  clearable?: boolean;
  onClear?: () => void;
  /** Class for the outer well (the `className` also lands there). */
  rootClassName?: string;
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }
  };
}

/**
 * Single-line text input set in a softly recessed well. On focus the well
 * lifts to the surface colour and gains an accent halo.
 */
export function Input({
  size = 'md',
  leading,
  trailing,
  invalid: invalidProp,
  clearable,
  onClear,
  className,
  rootClassName,
  ref,
  onChange,
  value,
  defaultValue,
  disabled: disabledProp,
  ...props
}: InputProps) {
  const {
    invalid,
    disabled,
    labelId: _labelId,
    ...field
  } = useFieldControl({
    ...props,
    invalid: invalidProp,
    disabled: disabledProp,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [uncontrolledHasValue, setUncontrolledHasValue] = useState(
    defaultValue != null && String(defaultValue) !== '',
  );
  const hasValue = value !== undefined ? String(value) !== '' : uncontrolledHasValue;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (value === undefined) setUncontrolledHasValue(event.target.value !== '');
    onChange?.(event);
  };

  const clear = () => {
    const input = inputRef.current;
    if (!input) return;
    setNativeValue(input, '');
    onClear?.();
    input.focus();
  };

  const showClear = clearable && hasValue && !disabled && !props.readOnly;

  // Pressing anywhere on the well (padding, icons) focuses the input.
  const focusFromWell = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target === inputRef.current || target.closest('button, a, input, [tabindex]')) return;
    event.preventDefault();
    inputRef.current?.focus();
  };

  return (
    // The well is a pointer convenience only; keyboard users reach the input directly.
    <div
      onPointerDown={focusFromWell}
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={cx(styles.well, className, rootClassName)}
    >
      {leading != null && (
        <span className={styles.slot} data-slot="leading">
          {leading}
        </span>
      )}
      <span className={styles.text}>
        <input
          ref={mergeRefs(inputRef, ref)}
          className={styles.input}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          {...props}
          {...field}
          disabled={disabled}
        />
      </span>
      {clearable && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear"
          data-visible={showClear || undefined}
          className={styles.clear}
          onClick={clear}
          disabled={!showClear}
        >
          <X aria-hidden />
        </button>
      )}
      {trailing != null && (
        <span className={styles.slot} data-slot="trailing">
          {trailing}
        </span>
      )}
    </div>
  );
}

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';

import { cx } from '../../utils/cx';
import { useFieldControl } from '../Field';
import wellStyles from '../Input/Input.module.css';
import styles from './Textarea.module.css';

export interface TextareaProps extends ComponentProps<'textarea'> {
  size?: 'sm' | 'md' | 'lg';
  /** Grow with content from `minRows` up to `maxRows`, then scroll. */
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  invalid?: boolean;
  /** Content pinned below the text (e.g. a character count or toolbar). */
  footer?: ReactNode;
  rootClassName?: string;
}

const supportsFieldSizing =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('field-sizing', 'content');

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }
  };
}

/**
 * Multi-line text input in the same well as `Input`. Autosizes using CSS
 * `field-sizing: content` where available, with a measured JS fallback.
 */
export function Textarea({
  size = 'md',
  autosize = true,
  minRows = 3,
  maxRows = 12,
  invalid: invalidProp,
  footer,
  className,
  rootClassName,
  style,
  ref,
  onChange,
  disabled: disabledProp,
  ...props
}: TextareaProps) {
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
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const jsAutosize = autosize && !supportsFieldSizing;

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el || !jsAutosize) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, minRows * line + pad), maxRows * line + pad);
    el.style.height = `${next}px`;
  }, [jsAutosize, minRows, maxRows]);

  useLayoutEffect(() => {
    resize();
  }, [resize, props.value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    resize();
    onChange?.(event);
  };

  return (
    <div
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={cx(wellStyles.well, styles.root, className, rootClassName)}
    >
      <textarea
        ref={mergeRefs(innerRef, ref)}
        data-autosize={autosize || undefined}
        rows={autosize ? undefined : minRows}
        className={styles.textarea}
        style={{ '--min-rows': minRows, '--max-rows': maxRows, ...style } as CSSProperties}
        onChange={handleChange}
        {...props}
        {...field}
        disabled={disabled}
      />
      {footer != null && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

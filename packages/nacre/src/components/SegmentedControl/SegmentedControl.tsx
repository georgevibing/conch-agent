import { MotionConfig, motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { springs } from '../../tokens';
import { cx } from '../../utils/cx';
import styles from './SegmentedControl.module.css';

interface SegmentedContextValue {
  value: string;
  indicatorId: string;
}

const SegmentedContext = createContext<SegmentedContextValue | null>(null);

export interface SegmentedControlProps extends Omit<
  ComponentProps<typeof ToggleGroup.Root>,
  'type' | 'value' | 'defaultValue' | 'onValueChange'
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** Stretch segments to fill the container equally. */
  block?: boolean;
}

/**
 * Mutually exclusive view switcher. A porcelain pill glides between segments
 * on a spring. Unlike a toggle group it can never be empty.
 */
function SegmentedControlRoot({
  value: valueProp,
  defaultValue = '',
  onValueChange,
  size = 'md',
  block,
  className,
  children,
  ...props
}: SegmentedControlProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = valueProp ?? internal;
  const indicatorId = useId();

  return (
    <SegmentedContext.Provider value={{ value, indicatorId }}>
      <MotionConfig reducedMotion="user">
        <ToggleGroup.Root
          type="single"
          value={value}
          onValueChange={(next) => {
            if (!next) return; // never allow deselecting
            if (valueProp === undefined) setInternal(next);
            onValueChange?.(next);
          }}
          data-size={size}
          data-block={block || undefined}
          className={cx(styles.root, className)}
          {...props}
        >
          {children}
        </ToggleGroup.Root>
      </MotionConfig>
    </SegmentedContext.Provider>
  );
}

export interface SegmentedControlItemProps extends ComponentProps<typeof ToggleGroup.Item> {
  icon?: ReactNode;
}

function SegmentedControlItem({
  icon,
  children,
  className,
  value,
  ...props
}: SegmentedControlItemProps) {
  const ctx = useContext(SegmentedContext);
  const active = ctx?.value === value;
  return (
    <ToggleGroup.Item value={value} className={cx(styles.item, className)} {...props}>
      {active && (
        <motion.span
          layoutId={ctx?.indicatorId}
          className={styles.indicator}
          transition={springs.snappy}
          aria-hidden
        />
      )}
      <span className={styles.content}>
        {icon != null && (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        )}
        {children != null && <span className={styles.label}>{children}</span>}
      </span>
    </ToggleGroup.Item>
  );
}

export const SegmentedControl = Object.assign(SegmentedControlRoot, {
  Root: SegmentedControlRoot,
  Item: SegmentedControlItem,
});

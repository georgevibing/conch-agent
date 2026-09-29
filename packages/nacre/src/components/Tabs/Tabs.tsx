import { LayoutGroup, motion, MotionConfig } from 'motion/react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { springs } from '../../tokens';
import { cx } from '../../utils/cx';
import styles from './Tabs.module.css';

type TabsVariant = 'line' | 'pill';

interface TabsContextValue {
  value: string | undefined;
  variant: TabsVariant;
  indicatorId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<Tabs.${component}> must be used inside <Tabs>.`);
  return ctx;
}

export interface TabsProps extends ComponentProps<typeof TabsPrimitive.Root> {
  /** `line` — underline indicator; `pill` — a soft glazed pill glides behind the active tab. */
  variant?: TabsVariant;
  size?: 'sm' | 'md';
}

function TabsRoot({
  variant = 'line',
  size = 'md',
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const value = valueProp ?? uncontrolled;
  const indicatorId = useId();
  const handleChange = useCallback(
    (next: string) => {
      if (valueProp === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [valueProp, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value, variant, indicatorId }}>
      <MotionConfig reducedMotion="user">
        <TabsPrimitive.Root
          value={value}
          onValueChange={handleChange}
          data-variant={variant}
          data-size={size}
          className={cx(styles.root, className)}
          {...props}
        >
          <LayoutGroup id={indicatorId}>{children}</LayoutGroup>
        </TabsPrimitive.Root>
      </MotionConfig>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const { variant } = useTabsContext('List');
  return (
    <TabsPrimitive.List data-variant={variant} className={cx(styles.list, className)} {...props} />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  icon?: ReactNode;
  /** Trailing count or badge. */
  meta?: ReactNode;
}

function TabsTrigger({ value, icon, meta, className, children, ...props }: TabsTriggerProps) {
  const ctx = useTabsContext('Trigger');
  const active = ctx.value === value;
  return (
    <TabsPrimitive.Trigger value={value} className={cx(styles.trigger, className)} {...props}>
      {active && (
        <motion.span
          layoutId="nacre-tab-indicator"
          className={styles.indicator}
          data-variant={ctx.variant}
          transition={springs.snappy}
          aria-hidden
        />
      )}
      {icon != null && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {meta != null && <span className={styles.meta}>{meta}</span>}
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cx(styles.content, className)} {...props} />;
}

/** Tabbed views with a spring-driven indicator that glides between tabs. */
export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
});

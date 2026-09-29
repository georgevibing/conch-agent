import { Accordion as AccordionPrimitive } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Accordion.module.css';

type RootProps = ComponentProps<typeof AccordionPrimitive.Root>;

export type AccordionProps = RootProps & {
  /** `divided` separates items with hairlines; `separated` renders each as a card. */
  variant?: 'divided' | 'separated';
};

function AccordionRoot({ variant = 'divided', className, ...props }: AccordionProps) {
  return (
    <AccordionPrimitive.Root
      data-variant={variant}
      className={cx(styles.root, className)}
      {...(props as RootProps)}
    />
  );
}

function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cx(styles.item, className)} {...props} />;
}

export interface AccordionTriggerProps extends ComponentProps<typeof AccordionPrimitive.Trigger> {
  /** Secondary text or element on the trailing side, before the chevron. */
  meta?: ReactNode;
  icon?: ReactNode;
}

function AccordionTrigger({ className, children, meta, icon, ...props }: AccordionTriggerProps) {
  return (
    <AccordionPrimitive.Header className={styles.header}>
      <AccordionPrimitive.Trigger className={cx(styles.trigger, className)} {...props}>
        {icon != null && (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        )}
        <span className={styles.title}>{children}</span>
        {meta != null && <span className={styles.meta}>{meta}</span>}
        <ChevronDown className={styles.chevron} aria-hidden />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content className={cx(styles.content, className)} {...props}>
      <div className={styles.inner}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

/** Vertically stacked disclosure sections. Arrow keys move between headers. */
export const Accordion = Object.assign(AccordionRoot, {
  Item: AccordionItem,
  Trigger: AccordionTrigger,
  Content: AccordionContent,
});

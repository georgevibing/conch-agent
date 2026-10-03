import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Button, type ButtonProps } from '../Button';
import { dialogStyles } from '../Dialog/Dialog';
import styles from './AlertDialog.module.css';

export interface AlertDialogContentProps extends ComponentProps<
  typeof AlertDialogPrimitive.Content
> {
  /** Emphasis colour of the icon badge. */
  tone?: 'danger' | 'accent' | 'neutral';
  /** Optional icon shown in a tinted badge above the title. */
  icon?: ReactNode;
  container?: HTMLElement | null;
}

function AlertDialogContent({
  tone = 'danger',
  icon,
  className,
  children,
  container,
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal container={container}>
      <AlertDialogPrimitive.Overlay className={dialogStyles.veil} />
      <AlertDialogPrimitive.Content
        data-size="sm"
        data-tone={tone}
        data-lustre=""
        className={cx(dialogStyles.content, styles.content, className)}
        {...props}
      >
        {icon != null && (
          <span className={styles.badge} aria-hidden>
            {icon}
          </span>
        )}
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cx(dialogStyles.title, styles.title, className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cx(dialogStyles.description, styles.description, className)}
      {...props}
    />
  );
}

function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.header, className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

/** The confirming action. Defaults to a solid danger button. */
function AlertDialogAction({ tone = 'danger', ...props }: ButtonProps) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button tone={tone} {...props} />
    </AlertDialogPrimitive.Action>
  );
}

/** The safe way out. Receives initial focus, as destructive flows should. */
function AlertDialogCancel({ variant = 'surface', children = 'Cancel', ...props }: ButtonProps) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button variant={variant} {...props}>
        {children}
      </Button>
    </AlertDialogPrimitive.Cancel>
  );
}

/**
 * Interrupting confirmation for consequential actions. Unlike Dialog it can't
 * be dismissed by clicking the veil, and focus starts on Cancel.
 */
export const AlertDialog = {
  Root: AlertDialogPrimitive.Root,
  Trigger: AlertDialogPrimitive.Trigger,
  Content: AlertDialogContent,
  Header: AlertDialogHeader,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  Footer: AlertDialogFooter,
  Action: AlertDialogAction,
  Cancel: AlertDialogCancel,
};

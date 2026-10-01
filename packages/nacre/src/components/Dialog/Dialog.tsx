import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { IconButton } from '../IconButton';
import styles from './Dialog.module.css';

/**
 * `full`: the whole window, as a page of its own (Settings). Its own way back
 * goes in it; Escape still closes it.
 */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: DialogSize;
  /** Hide the corner close button (Escape and the veil still dismiss). */
  hideClose?: boolean;
  /** Extra content rendered outside the scrolling body, e.g. a hero image. */
  children?: ReactNode;
  /** Container to portal into. Defaults to `document.body`. */
  container?: HTMLElement | null;
}

/**
 * The veil: instead of frosting the page, Nacre drains it of colour and
 * dims it with a soft vignette, so the dialog is the only thing left in full
 * colour. Calm, legible, and cheap to render (no blur).
 */
function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cx(styles.veil, className)} {...props} />;
}

function DialogContent({
  size = 'md',
  hideClose = false,
  className,
  children,
  container,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-size={size}
        data-lustre=""
        className={cx(styles.content, className)}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" tooltip={false} size="sm" className={styles.close}>
              <X />
            </IconButton>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.header, className)} {...props} />;
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cx(styles.description, className)} {...props} />;
}

function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.body, className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

/**
 * Modal dialog. Focus is trapped, background is inert, Escape and a click on
 * the veil dismiss. Always give it a `Dialog.Title` (visually hidden if need be).
 */
export const Dialog = {
  Root: DialogPrimitive.Root,
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Portal: DialogPrimitive.Portal,
  Overlay: DialogOverlay,
  Content: DialogContent,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Body: DialogBody,
  Footer: DialogFooter,
};

export { styles as dialogStyles };

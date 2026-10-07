import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { keepOpenForToasts } from '../../utils/toasts';
import { Dialog, dialogStyles } from '../Dialog/Dialog';
import { IconButton } from '../IconButton';
import { PanelGlint } from '../PanelPresence';
import styles from './Sheet.module.css';

export type SheetSide = 'left' | 'right' | 'bottom';

export interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  side?: SheetSide;
  /** Width for left/right sheets, max height for bottom sheets. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Floating sheets hover a few pixels from the viewport edge with rounded
   * corners — the default. Set `false` for a flush, edge-to-edge panel.
   */
  floating?: boolean;
  hideClose?: boolean;
  container?: HTMLElement | null;
}

function SheetContent({
  side = 'right',
  size = 'md',
  floating = true,
  hideClose = false,
  className,
  children,
  container,
  onInteractOutside,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      <Dialog.Overlay />
      <DialogPrimitive.Content
        data-side={side}
        data-size={size}
        data-floating={floating || undefined}
        className={cx(styles.content, className)}
        onInteractOutside={keepOpenForToasts(onInteractOutside)}
        {...props}
      >
        {side === 'bottom' && <span className={styles.grabber} aria-hidden />}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" tooltip={false} size="sm" className={dialogStyles.close}>
              <X />
            </IconButton>
          </DialogPrimitive.Close>
        )}
        {/* Arrives and leaves like every panel ("glint", motion.css). */}
        <PanelGlint />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * A dialog that slides in from an edge — for session lists on mobile,
 * settings, or inspecting a tool call without leaving the conversation.
 */
export const Sheet = {
  Root: DialogPrimitive.Root,
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Content: SheetContent,
  Header: Dialog.Header,
  Title: Dialog.Title,
  Description: Dialog.Description,
  Body: Dialog.Body,
  Footer: Dialog.Footer,
};

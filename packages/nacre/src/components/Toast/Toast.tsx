import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Toaster as SonnerToaster, toast, type ToasterProps as SonnerToasterProps } from 'sonner';

import { useNacreTheme } from '../../theme';
import { cx } from '../../utils/cx';
import { Spinner } from '../Spinner';
import styles from './Toast.module.css';

export type ToasterProps = Omit<SonnerToasterProps, 'theme' | 'icons'>;

/**
 * Themed toast region. Mount once near the app root (inside NacreProvider),
 * then call `toast()` from anywhere:
 *
 *   toast.success('Session saved');
 *   toast.promise(run(), { loading: 'Running…', success: 'Done', error: 'Failed' });
 *
 * Toasts announce politely to screen readers, pause while hovered or focused,
 * and can be swiped away. Keyboard users jump to them with Alt+T.
 */
export function Toaster({
  position = 'bottom-right',
  gap = 10,
  visibleToasts = 4,
  toastOptions,
  className,
  ...props
}: ToasterProps) {
  const { resolvedMode } = useNacreTheme();
  return (
    <SonnerToaster
      theme={resolvedMode}
      position={position}
      gap={gap}
      visibleToasts={visibleToasts}
      hotkey={['altKey', 'KeyT']}
      containerAriaLabel="Notifications"
      className={cx(styles.toaster, className)}
      icons={{
        success: <CircleCheck />,
        error: <CircleAlert />,
        info: <Info />,
        warning: <TriangleAlert />,
        loading: <Spinner size="sm" label={null} />,
        close: <X />,
      }}
      toastOptions={{
        ...toastOptions,
        unstyled: true,
        classNames: {
          toast: styles.toast,
          icon: styles.icon,
          content: styles.content,
          title: styles.title,
          description: styles.description,
          actionButton: styles.action,
          cancelButton: styles.cancel,
          closeButton: styles.close,
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}

export { toast };

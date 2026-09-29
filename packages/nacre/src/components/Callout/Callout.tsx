import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Sparkles } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Callout.module.css';

export type CalloutTone = 'accent' | 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const defaultIcons: Record<CalloutTone, ReactNode> = {
  accent: <Sparkles />,
  neutral: <Info />,
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <OctagonAlert />,
};

export interface CalloutProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: CalloutTone;
  title?: ReactNode;
  /** Custom icon, or `false` to hide it. Defaults to a tone-appropriate icon. */
  icon?: ReactNode | false;
  /** Trailing action(s), e.g. a small Button. */
  action?: ReactNode;
  /**
   * `polite` announces the callout when it appears (role="status"),
   * `assertive` interrupts (role="alert"). Default: not announced.
   */
  live?: 'polite' | 'assertive';
}

/** Inline, contextual message tied to the surrounding content. */
export function Callout({
  tone = 'info',
  title,
  icon,
  action,
  live,
  className,
  children,
  ...props
}: CalloutProps) {
  const resolvedIcon = icon === false ? null : (icon ?? defaultIcons[tone]);
  return (
    <div
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
      data-tone={tone}
      className={cx(styles.callout, className)}
      {...props}
    >
      {resolvedIcon != null && (
        <span className={styles.icon} aria-hidden>
          {resolvedIcon}
        </span>
      )}
      <div className={styles.body}>
        {title != null && <p className={styles.title}>{title}</p>}
        {children != null && <div className={styles.description}>{children}</div>}
      </div>
      {action != null && <div className={styles.action}>{action}</div>}
    </div>
  );
}

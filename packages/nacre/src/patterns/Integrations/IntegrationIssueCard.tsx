import { ArrowRight } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from './IntegrationLogo';
import styles from './IntegrationIssueCard.module.css';

export interface IntegrationIssueCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  name: string;
  brand?: string;
  color?: string;
  state: 'needs-auth' | 'error';
  message: string;
  /** Label for the fix button; defaults by state. */
  actionLabel?: string;
  onFix?: () => void;
  /** Already fixed since: the card settles into a quiet note. */
  resolved?: boolean;
}

/**
 * Shown in a chat when an integration Claude would have used isn't working,
 * so the problem is visible where you noticed it — with the one button that
 * fixes it — instead of Claude quietly doing without.
 */
export function IntegrationIssueCard({
  name,
  brand,
  color,
  state,
  message,
  actionLabel,
  onFix,
  resolved,
  className,
  ...props
}: IntegrationIssueCardProps) {
  const title = resolved
    ? `${name} is working again`
    : state === 'needs-auth'
      ? `${name} needs you to sign in again`
      : `${name} isn’t working`;
  return (
    <div
      role="note"
      data-state={state}
      data-resolved={resolved || undefined}
      className={cx(styles.card, className)}
      {...props}
    >
      <IntegrationLogo
        brand={brand}
        name={name}
        color={color}
        size="sm"
        status={resolved ? 'ok' : state}
        decorative
      />
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {!resolved && <p className={styles.message}>{message}</p>}
      </div>
      {!resolved && onFix && (
        <Button size="sm" variant="surface" trailingIcon={<ArrowRight />} onClick={onFix}>
          {actionLabel ?? (state === 'needs-auth' ? 'Reconnect' : 'Fix it')}
        </Button>
      )}
    </div>
  );
}

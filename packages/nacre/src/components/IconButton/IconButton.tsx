import type { ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Button, type ButtonProps } from '../Button';
import { Tooltip, type TooltipProps } from '../Tooltip';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  ButtonProps,
  'leadingIcon' | 'trailingIcon' | 'children' | 'block' | 'asChild'
> {
  /** The icon. Decorative — the accessible name comes from `label`. */
  children: ReactNode;
  /** Accessible name. Also shown as a tooltip unless `tooltip` is `false`. */
  label: string;
  /** Show `label` in a tooltip (default) or pass custom tooltip content. */
  tooltip?: boolean | ReactNode;
  tooltipSide?: TooltipProps['side'];
  /** Shortcut shown inside the tooltip. */
  shortcut?: string | string[];
  shape?: 'square' | 'circle';
}

/** Square icon-only button with a mandatory accessible label. */
export function IconButton({
  children,
  label,
  tooltip = true,
  tooltipSide,
  shortcut,
  shape = 'square',
  variant = 'ghost',
  className,
  loading,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      variant={variant}
      aria-label={label}
      loading={loading}
      data-shape={shape}
      className={cx(styles.iconButton, className)}
      leadingIcon={children}
      {...props}
    />
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip === true ? label : tooltip} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}

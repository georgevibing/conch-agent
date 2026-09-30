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
  /**
   * A small dot in the corner: something is waiting behind this button (an
   * update). The words are read after the label and shown in its tooltip:
   * "Update available". Quiet on purpose — never a count, never a colour alone.
   */
  dot?: string;
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
  dot,
  className,
  loading,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      variant={variant}
      aria-label={dot ? `${label}, ${dot}` : label}
      loading={loading}
      data-shape={shape}
      data-dot={dot ? '' : undefined}
      className={cx(styles.iconButton, className)}
      leadingIcon={
        dot ? (
          <>
            {children}
            <span className={styles.dot} aria-hidden />
          </>
        ) : (
          children
        )
      }
      {...props}
    />
  );
  if (tooltip === false) return button;
  const content = tooltip === true ? (dot ? `${label} · ${dot}` : label) : tooltip;
  return (
    <Tooltip content={content} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}

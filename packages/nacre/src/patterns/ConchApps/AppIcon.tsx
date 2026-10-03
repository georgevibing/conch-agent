import { createElement, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { IntegrationLogo, type IntegrationLogoProps } from '../Integrations/IntegrationLogo';
import styles from './AppIcon.module.css';
import { appColor, appGlyphIcon, type AppColor, type AppGlyph } from './glyphs';

/** What an app's icon is: one of Nacre's glyphs on one of its colours (`manifest.icon`). */
export interface AppIconLook {
  glyph: AppGlyph;
  color: AppColor;
}

export interface AppIconProps
  extends AppIconLook, Omit<ComponentProps<'span'>, 'children' | 'color'> {
  size?: IntegrationLogoProps['size'];
  /** The app's name, read to screen readers. Leave it out when the name is beside it. */
  label?: string;
  /** A status dot in the corner, as on an integration's logo. */
  status?: IntegrationLogoProps['status'];
}

/**
 * A Conch app's icon (ADR 0061): a glyph on a tile of its colour, drawn the
 * way an integration's logo is, so a plant diary someone made sits among
 * Notion and GitHub as one of them. Nothing is fetched: the glyph is one of
 * Lucide's, the colour is a token (`--nc-app-*`).
 */
export function AppIcon({
  glyph,
  color,
  size = 'md',
  label,
  status,
  className,
  ...props
}: AppIconProps) {
  return (
    <IntegrationLogo
      name={label ?? ''}
      decorative={!label}
      icon={createElement(appGlyphIcon(glyph))}
      size={size}
      status={status}
      data-app-color={appColor(color)}
      className={cx(styles.icon, className)}
      {...props}
    />
  );
}

import { createElement, useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { IntegrationLogo, type IntegrationLogoProps } from '../Integrations/IntegrationLogo';
import styles from './AppIcon.module.css';
import { appColor, appGlyphIcon, type AppColor, type AppGlyph } from './glyphs';

/**
 * What an app's icon is: one of Nacre's glyphs on one of its colours
 * (`manifest.icon`), and its picture when it has one (ADR 0090).
 */
export interface AppIconLook {
  glyph: AppGlyph;
  color: AppColor;
  /**
   * The app's picture (a logo, a photo), drawn in the tile instead of the
   * glyph: an address Conch serves from the app's own folder. The glyph shows
   * until it has loaded, and stays if it can't.
   */
  src?: string;
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
 * Notion and GitHub as one of them. The glyph is one of Lucide's and the
 * colour a token (`--nc-app-*`), so it's there on the first frame. An app
 * with a picture (`src`) shows it in the same tile once it has loaded —
 * nothing moves, and a picture that fails leaves the glyph where it was.
 */
export function AppIcon({
  glyph,
  color,
  src,
  size = 'md',
  label,
  status,
  className,
  ...props
}: AppIconProps) {
  // Which picture loaded, and which failed: a new `src` starts again from the glyph.
  const [loaded, setLoaded] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const picture = src && failed !== src ? src : undefined;
  const shown = picture !== undefined && loaded === picture;
  return (
    <IntegrationLogo
      name={label ?? ''}
      decorative={!label}
      icon={
        <>
          {createElement(appGlyphIcon(glyph))}
          {picture && (
            <span className={styles.picture} data-shown={shown || undefined}>
              <img
                key={picture}
                src={picture}
                alt=""
                draggable={false}
                decoding="async"
                // A picture already in the cache may be complete before React listens.
                ref={(img) => {
                  if (img?.complete && img.naturalWidth > 0 && loaded !== picture)
                    setLoaded(picture);
                }}
                onLoad={() => setLoaded(picture)}
                onError={() => setFailed(picture)}
              />
            </span>
          )}
        </>
      }
      size={size}
      status={status}
      data-app-color={appColor(color)}
      data-picture={shown || undefined}
      className={cx(styles.icon, className)}
      {...props}
    />
  );
}

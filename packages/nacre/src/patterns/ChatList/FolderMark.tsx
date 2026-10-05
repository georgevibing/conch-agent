import { createElement, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { appColor, appGlyphIcon, type AppColor, type AppGlyph } from '../ConchApps/glyphs';
import styles from './Folder.module.css';

/** What a folder looks like: one of the app glyphs, in one of the app colours. */
export interface FolderLook {
  glyph: AppGlyph;
  color: AppColor;
}

export interface FolderMarkProps
  extends FolderLook, Omit<ComponentProps<'span'>, 'children' | 'color'> {
  /** `xs` beside a small label, `sm` (default) in the list, `md` for a preview. */
  size?: 'xs' | 'sm' | 'md';
  /** The folder's name, read to screen readers. Leave it out when the name is beside it. */
  label?: string;
}

/**
 * A folder's small mark: its glyph in its colour, on a soft wash of that
 * colour. Deliberately lighter than an app's solid tile, so a folder never
 * reads as an app.
 */
export function FolderMark({
  glyph,
  color,
  size = 'sm',
  label,
  className,
  ...props
}: FolderMarkProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-size={size}
      data-folder-color={appColor(color)}
      className={cx(styles.mark, className)}
      {...props}
    >
      {createElement(appGlyphIcon(glyph), { 'aria-hidden': true })}
    </span>
  );
}

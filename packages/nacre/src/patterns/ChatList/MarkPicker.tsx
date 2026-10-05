import { Check } from 'lucide-react';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { createElement, useId, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { appGlyphIcon, type AppColor, type AppGlyph } from '../ConchApps/glyphs';
import styles from './Folder.module.css';
import type { FolderLook } from './FolderMark';

/** The glyphs that suit a folder: places, work, hobbies, a few marks. */
export const FOLDER_GLYPHS = [
  'folder',
  'briefcase',
  'house',
  'heart',
  'code',
  'book-open',
  'graduation-cap',
  'lightbulb',
  'chart-line',
  'calendar',
  'plane',
  'camera',
  'music',
  'dumbbell',
  'leaf',
  'coffee',
  'wrench',
  'sparkles',
  'star',
  'flag',
  'gift',
  'credit-card',
  'mail',
  'globe',
] as const satisfies readonly AppGlyph[];

/** The colours a folder may take: distinct enough to tell apart at a glance. */
export const FOLDER_COLORS = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
  'slate',
] as const satisfies readonly AppColor[];

const GLYPH_NAMES: Partial<Record<AppGlyph, string>> = {
  'book-open': 'Book',
  'graduation-cap': 'Graduation cap',
  lightbulb: 'Light bulb',
  'chart-line': 'Chart',
  'credit-card': 'Card',
  'shopping-cart': 'Shopping cart',
  'map-pin': 'Pin',
  'heart-pulse': 'Health',
  'list-checks': 'Checklist',
};

/** A glyph's name, as a person says it: “Briefcase”, “Light bulb”. */
export function glyphName(glyph: AppGlyph): string {
  const named = GLYPH_NAMES[glyph];
  if (named) return named;
  const words = glyph.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A colour's name: “Blue”. */
export function colorName(color: AppColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export interface MarkPickerProps extends Omit<
  ComponentProps<'div'>,
  'onChange' | 'defaultValue' | 'dir'
> {
  value: FolderLook;
  onChange: (next: FolderLook) => void;
  /** The glyphs offered. The folder's own is added if it isn't among them. */
  glyphs?: readonly AppGlyph[];
  /** The colours offered. */
  colors?: readonly AppColor[];
}

/**
 * Choose a folder's look: a row of colours, then a grid of glyphs drawn in
 * the chosen colour. Each is a set of radio buttons: Tab moves between the
 * two, arrow keys within one, and every option has a name (“Blue”,
 * “Briefcase”).
 */
export function MarkPicker({
  value,
  onChange,
  glyphs = FOLDER_GLYPHS,
  colors = FOLDER_COLORS,
  className,
  ...props
}: MarkPickerProps) {
  const id = useId();
  const glyphList = glyphs.includes(value.glyph) ? glyphs : [...glyphs, value.glyph];
  const colorList = colors.includes(value.color) ? colors : [...colors, value.color];
  return (
    <div data-folder-color={value.color} className={cx(styles.picker, className)} {...props}>
      <div className={styles.pickerGroup}>
        <span id={`${id}-colour`} className={styles.pickerLabel}>
          Colour
        </span>
        <RadioPrimitive.Root
          aria-labelledby={`${id}-colour`}
          orientation="horizontal"
          loop
          value={value.color}
          onValueChange={(color) => onChange({ ...value, color: color as AppColor })}
          className={styles.swatches}
        >
          {colorList.map((color) => (
            <RadioPrimitive.Item
              key={color}
              value={color}
              aria-label={colorName(color)}
              data-folder-color={color}
              className={styles.swatch}
            >
              <RadioPrimitive.Indicator className={styles.swatchTick}>
                <Check aria-hidden />
              </RadioPrimitive.Indicator>
            </RadioPrimitive.Item>
          ))}
        </RadioPrimitive.Root>
      </div>
      <div className={styles.pickerGroup}>
        <span id={`${id}-icon`} className={styles.pickerLabel}>
          Icon
        </span>
        <RadioPrimitive.Root
          aria-labelledby={`${id}-icon`}
          loop
          value={value.glyph}
          onValueChange={(glyph) => onChange({ ...value, glyph: glyph as AppGlyph })}
          className={styles.glyphs}
        >
          {glyphList.map((glyph) => (
            <RadioPrimitive.Item
              key={glyph}
              value={glyph}
              aria-label={glyphName(glyph)}
              className={styles.glyph}
            >
              {createElement(appGlyphIcon(glyph), { 'aria-hidden': true })}
            </RadioPrimitive.Item>
          ))}
        </RadioPrimitive.Root>
      </div>
    </div>
  );
}

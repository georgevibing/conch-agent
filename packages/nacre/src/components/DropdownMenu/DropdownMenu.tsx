import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import {
  CheckIndicator,
  ItemSlots,
  menuStyles as styles,
  RadioDot,
  SubChevron,
  useMenuGlide,
  type MenuItemSlotsProps,
} from './menuShared';

const availableHeight = {
  '--menu-available-height': 'var(--radix-dropdown-menu-content-available-height)',
  transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
} as CSSProperties;

export interface DropdownMenuContentProps extends ComponentProps<typeof MenuPrimitive.Content> {
  container?: HTMLElement | null;
}

function DropdownMenuContent({
  sideOffset = 6,
  collisionPadding = 12,
  align = 'start',
  className,
  style,
  children,
  container,
  onFocus,
  onBlur,
  ...props
}: DropdownMenuContentProps) {
  const glide = useMenuGlide();
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        className={cx(styles.content, className)}
        style={{ ...availableHeight, ...style }}
        onFocus={(e) => {
          glide.onFocus(e);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          glide.onBlur(e);
          onBlur?.(e);
        }}
        {...props}
      >
        {glide.glide}
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuSubContent({
  sideOffset = 6,
  collisionPadding = 12,
  className,
  style,
  children,
  container,
  ...props
}: DropdownMenuContentProps & ComponentProps<typeof MenuPrimitive.SubContent>) {
  const glide = useMenuGlide();
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.SubContent
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cx(styles.content, className)}
        style={{ ...availableHeight, ...style }}
        onFocus={glide.onFocus}
        onBlur={glide.onBlur}
        {...props}
      >
        {glide.glide}
        {children}
      </MenuPrimitive.SubContent>
    </MenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps
  extends Omit<ComponentProps<typeof MenuPrimitive.Item>, 'children'>, MenuItemSlotsProps {
  tone?: 'default' | 'danger';
}

function DropdownMenuItem({
  icon,
  shortcut,
  trailing,
  inset,
  tone = 'default',
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-tone={tone}
      data-inset={inset || undefined}
      className={cx(styles.item, className)}
      {...props}
    >
      <ItemSlots icon={icon} shortcut={shortcut} trailing={trailing}>
        {children}
      </ItemSlots>
    </MenuPrimitive.Item>
  );
}

export interface DropdownMenuCheckboxItemProps
  extends
    Omit<ComponentProps<typeof MenuPrimitive.CheckboxItem>, 'children'>,
    Omit<MenuItemSlotsProps, 'icon' | 'inset'> {}

function DropdownMenuCheckboxItem({
  shortcut,
  trailing,
  className,
  children,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem className={cx(styles.item, className)} {...props}>
      <span className={styles.indicator} aria-hidden>
        <MenuPrimitive.ItemIndicator>
          <CheckIndicator />
        </MenuPrimitive.ItemIndicator>
      </span>
      <ItemSlots shortcut={shortcut} trailing={trailing}>
        {children}
      </ItemSlots>
    </MenuPrimitive.CheckboxItem>
  );
}

export interface DropdownMenuRadioItemProps
  extends
    Omit<ComponentProps<typeof MenuPrimitive.RadioItem>, 'children'>,
    Omit<MenuItemSlotsProps, 'icon' | 'inset'> {}

function DropdownMenuRadioItem({
  shortcut,
  trailing,
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem className={cx(styles.item, className)} {...props}>
      <span className={styles.indicator} aria-hidden>
        <MenuPrimitive.ItemIndicator>
          <RadioDot />
        </MenuPrimitive.ItemIndicator>
      </span>
      <ItemSlots shortcut={shortcut} trailing={trailing}>
        {children}
      </ItemSlots>
    </MenuPrimitive.RadioItem>
  );
}

export interface DropdownMenuSubTriggerProps
  extends
    Omit<ComponentProps<typeof MenuPrimitive.SubTrigger>, 'children'>,
    Pick<MenuItemSlotsProps, 'icon' | 'inset' | 'children'> {}

function DropdownMenuSubTrigger({
  icon,
  inset,
  className,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <MenuPrimitive.SubTrigger
      data-inset={inset || undefined}
      className={cx(styles.item, className)}
      {...props}
    >
      <ItemSlots icon={icon}>{children}</ItemSlots>
      <SubChevron />
    </MenuPrimitive.SubTrigger>
  );
}

function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cx(styles.menuLabel, className)} {...props} />;
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

/**
 * Menu of actions opened from a button. Full keyboard support (arrows,
 * typeahead, Home/End), submenus, checkbox and radio items.
 */
export const DropdownMenu = {
  Root: MenuPrimitive.Root,
  Trigger: MenuPrimitive.Trigger,
  Content: DropdownMenuContent,
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  RadioGroup: MenuPrimitive.RadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Group: MenuPrimitive.Group,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Sub: MenuPrimitive.Sub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

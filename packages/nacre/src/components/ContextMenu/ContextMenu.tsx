import { ContextMenu as MenuPrimitive } from 'radix-ui';
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
} from '../DropdownMenu/menuShared';

const availableHeight = {
  '--menu-available-height': 'var(--radix-context-menu-content-available-height)',
  transformOrigin: 'var(--radix-context-menu-content-transform-origin)',
} as CSSProperties;

export interface ContextMenuContentProps extends ComponentProps<typeof MenuPrimitive.Content> {
  container?: HTMLElement | null;
}

function ContextMenuContent({
  collisionPadding = 12,
  className,
  style,
  children,
  container,
  onFocus,
  onBlur,
  ...props
}: ContextMenuContentProps) {
  const glide = useMenuGlide();
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Content
        collisionPadding={collisionPadding}
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

function ContextMenuSubContent({
  sideOffset = 6,
  collisionPadding = 12,
  className,
  style,
  children,
  container,
  ...props
}: ContextMenuContentProps & ComponentProps<typeof MenuPrimitive.SubContent>) {
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

export interface ContextMenuItemProps
  extends Omit<ComponentProps<typeof MenuPrimitive.Item>, 'children'>, MenuItemSlotsProps {
  tone?: 'default' | 'danger';
}

function ContextMenuItem({
  icon,
  shortcut,
  trailing,
  inset,
  tone = 'default',
  className,
  children,
  ...props
}: ContextMenuItemProps) {
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

export interface ContextMenuCheckboxItemProps
  extends
    Omit<ComponentProps<typeof MenuPrimitive.CheckboxItem>, 'children'>,
    Omit<MenuItemSlotsProps, 'icon' | 'inset'> {}

function ContextMenuCheckboxItem({
  shortcut,
  trailing,
  className,
  children,
  ...props
}: ContextMenuCheckboxItemProps) {
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

export interface ContextMenuRadioItemProps
  extends
    Omit<ComponentProps<typeof MenuPrimitive.RadioItem>, 'children'>,
    Omit<MenuItemSlotsProps, 'icon' | 'inset'> {}

function ContextMenuRadioItem({
  shortcut,
  trailing,
  className,
  children,
  ...props
}: ContextMenuRadioItemProps) {
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

export interface ContextMenuSubTriggerProps
  extends
    Omit<ComponentProps<typeof MenuPrimitive.SubTrigger>, 'children'>,
    Pick<MenuItemSlotsProps, 'icon' | 'inset' | 'children'> {}

function ContextMenuSubTrigger({
  icon,
  inset,
  className,
  children,
  ...props
}: ContextMenuSubTriggerProps) {
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

function ContextMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cx(styles.menuLabel, className)} {...props} />;
}

function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

/**
 * Right-click / long-press menu. Shares every part and style with
 * DropdownMenu. Always duplicate its actions somewhere discoverable — context
 * menus are an accelerator, never the only path.
 */
export const ContextMenu = {
  Root: MenuPrimitive.Root,
  Trigger: MenuPrimitive.Trigger,
  Content: ContextMenuContent,
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  RadioGroup: MenuPrimitive.RadioGroup,
  RadioItem: ContextMenuRadioItem,
  Group: MenuPrimitive.Group,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Sub: MenuPrimitive.Sub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

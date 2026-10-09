import { ContextMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import {
  DrillLevel,
  DrillSub,
  DrillTrigger,
  useDrill,
  useDrillContent,
  useMergedRef,
  useOnShownLevel,
  useSubId,
  useSubmenuMode,
  type SubmenuMode,
} from '../DropdownMenu/menuDrill';
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
  /** How a submenu opens: beside with a pointer, in place on a phone (`auto`). See DropdownMenu. */
  submenus?: SubmenuMode;
}

function ContextMenuContent({
  collisionPadding = 12,
  submenus = 'auto',
  className,
  style,
  children,
  container,
  onFocus,
  onBlur,
  onKeyDown,
  onEscapeKeyDown,
  ref,
  ...props
}: ContextMenuContentProps) {
  const glide = useMenuGlide();
  const mode = useSubmenuMode(submenus);
  const drill = useDrillContent(MenuPrimitive.Item, mode === 'drill');
  const merged = useMergedRef(ref, drill.ref);
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Content
        ref={merged}
        collisionPadding={collisionPadding}
        data-submenus={mode}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented) drill.onKeyDown(e);
        }}
        onEscapeKeyDown={(e) => {
          onEscapeKeyDown?.(e);
          if (!e.defaultPrevented) drill.onEscapeKeyDown(e);
        }}
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
        {drill.render(children)}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

export interface ContextMenuSubContentProps extends ComponentProps<
  typeof MenuPrimitive.SubContent
> {
  container?: HTMLElement | null;
  /** What the back row says when the menu drills in. Default: the words of the row that opened it. */
  backLabel?: string;
}

function ContextMenuSubContent({
  sideOffset = 6,
  collisionPadding = 12,
  backLabel,
  className,
  style,
  children,
  container,
  ...props
}: ContextMenuSubContentProps) {
  const glide = useMenuGlide();
  const drill = useDrill();
  const subId = useSubId();
  if (drill && subId)
    return (
      <DrillLevel backLabel={backLabel} className={className}>
        {children}
      </DrillLevel>
    );
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
  if (!useOnShownLevel()) return null;
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
  if (!useOnShownLevel()) return null;
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
  if (!useOnShownLevel()) return null;
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
  const shown = useOnShownLevel();
  const drill = useDrill();
  const subId = useSubId();
  if (!shown) return null;
  if (drill && subId)
    return (
      <DrillTrigger
        className={cx(styles.item, className)}
        inset={inset}
        disabled={props.disabled}
        textValue={props.textValue}
      >
        <ItemSlots icon={icon}>{children}</ItemSlots>
        <SubChevron />
      </DrillTrigger>
    );
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

function ContextMenuSub(props: ComponentProps<typeof MenuPrimitive.Sub>) {
  if (useDrill()) return <DrillSub>{props.children}</DrillSub>;
  return <MenuPrimitive.Sub {...props} />;
}

function ContextMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  if (!useOnShownLevel()) return null;
  return <MenuPrimitive.Label className={cx(styles.menuLabel, className)} {...props} />;
}

function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  if (!useOnShownLevel()) return null;
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
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

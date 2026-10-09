import { DropdownMenu as MenuPrimitive } from 'radix-ui';
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
} from './menuDrill';
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
  /**
   * How a submenu opens. `auto` (the default) opens it beside the menu with a
   * pointer, and on a phone or a touch screen slides the same menu over to
   * it, with a back row at its top. `side` and `drill` choose one always.
   */
  submenus?: SubmenuMode;
}

function DropdownMenuContent({
  sideOffset = 6,
  collisionPadding = 12,
  align = 'start',
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
}: DropdownMenuContentProps) {
  const glide = useMenuGlide();
  const mode = useSubmenuMode(submenus);
  const drill = useDrillContent(MenuPrimitive.Item, mode === 'drill');
  const merged = useMergedRef(ref, drill.ref);
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Content
        ref={merged}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        data-submenus={mode}
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
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented) drill.onKeyDown(e);
        }}
        onEscapeKeyDown={(e) => {
          onEscapeKeyDown?.(e);
          if (!e.defaultPrevented) drill.onEscapeKeyDown(e);
        }}
        {...props}
      >
        {glide.glide}
        {drill.render(children)}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

export interface DropdownMenuSubContentProps extends ComponentProps<
  typeof MenuPrimitive.SubContent
> {
  container?: HTMLElement | null;
  /** What the back row says when the menu drills in. Default: the words of the row that opened it. */
  backLabel?: string;
}

function DropdownMenuSubContent({
  sideOffset = 6,
  collisionPadding = 12,
  backLabel,
  className,
  style,
  children,
  container,
  ...props
}: DropdownMenuSubContentProps) {
  const glide = useMenuGlide();
  const drill = useDrill();
  const subId = useSubId();
  const drilling = drill !== null && subId !== null;
  if (drilling)
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

function DropdownMenuSub(props: ComponentProps<typeof MenuPrimitive.Sub>) {
  if (useDrill()) return <DrillSub>{props.children}</DrillSub>;
  return <MenuPrimitive.Sub {...props} />;
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
  const shown = useOnShownLevel();
  const drill = useDrill();
  const subId = useSubId();
  const drilling = drill !== null && subId !== null;
  if (!shown) return null;
  if (drilling)
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

function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  if (!useOnShownLevel()) return null;
  return <MenuPrimitive.Label className={cx(styles.menuLabel, className)} {...props} />;
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  if (!useOnShownLevel()) return null;
  return <MenuPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

/**
 * Menu of actions opened from a button. Full keyboard support (arrows,
 * typeahead, Home/End), submenus, checkbox and radio items. A submenu opens
 * beside the menu with a pointer; on a phone the menu slides over to it in
 * place, with a back row at its top (`submenus`).
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
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

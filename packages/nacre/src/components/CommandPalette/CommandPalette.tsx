import { Command, useCommandState } from 'cmdk';
import { Search } from 'lucide-react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import { dialogStyles } from '../Dialog/Dialog';
import { Kbd } from '../Kbd';
import { Spinner } from '../Spinner';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Global shortcut that toggles the palette. `null` to disable. */
  hotkey?: string | null;
  /** Accessible title of the dialog (visually hidden). */
  title?: string;
  placeholder?: string;
  /** Controlled search value. */
  search?: string;
  onSearchChange?: (search: string) => void;
  /** Show a spinner while results load asynchronously. */
  loading?: boolean;
  /** Content shown when nothing matches. */
  empty?: ReactNode;
  /** Disable cmdk's built-in fuzzy filter (for server-side search). */
  shouldFilter?: boolean;
  /** Hide the keyboard hint footer. */
  hideFooter?: boolean;
  /** Replaces the default keyboard hints in the footer. */
  footer?: ReactNode;
  /** A pane beside the results (e.g. a preview of the selected item). Hidden on narrow screens. */
  aside?: ReactNode;
  /** `lg` makes room for an `aside`. */
  size?: 'md' | 'lg';
  /** Controlled selected item `value`. */
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const parts = hotkey.toLowerCase().split('+');
  const key = parts.pop();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const wants = (m: string) => parts.includes(m);
  const mod = isMac ? event.metaKey : event.ctrlKey;
  return (
    event.key.toLowerCase() === key &&
    (wants('mod') ? mod : true) &&
    wants('shift') === event.shiftKey &&
    wants('alt') === event.altKey
  );
}

/** A single wash that glides to the selected item, matching Nacre menus. */
function SelectionGlide() {
  const value = useCommandState((state) => state.value);
  const search = useCommandState((state) => state.search);
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const glide = ref.current;
    const sizer = glide?.parentElement;
    if (!glide || !sizer) return;
    const item = sizer.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
    if (!item) {
      glide.removeAttribute('data-visible');
      return;
    }
    const wasVisible = glide.hasAttribute('data-visible');
    if (!wasVisible) glide.style.transition = 'none';
    glide.style.setProperty('--glide-y', `${item.offsetTop}px`);
    glide.style.setProperty('--glide-h', `${item.offsetHeight}px`);
    glide.setAttribute('data-visible', '');
    if (!wasVisible) {
      void glide.offsetWidth;
      glide.style.transition = '';
    }
  }, [value, search]);

  return <span ref={ref} className={styles.glide} aria-hidden />;
}

function CommandPaletteRoot({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  hotkey = 'mod+k',
  title = 'Command palette',
  placeholder = 'Type a command or search…',
  search,
  onSearchChange,
  loading = false,
  empty = 'No results found.',
  shouldFilter,
  hideFooter = false,
  footer,
  aside,
  size = 'md',
  value,
  onValueChange,
  children,
  className,
}: CommandPaletteProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      const next = !openRef.current;
      setUncontrolled((prev) => (openProp === undefined ? !prev : prev));
      onOpenChangeRef.current?.(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hotkey, openProp]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogStyles.veil} />
        <DialogPrimitive.Content
          data-lustre=""
          data-size={size}
          data-aside={aside ? '' : undefined}
          aria-describedby={undefined}
          className={cx(dialogStyles.content, styles.content, className)}
        >
          <VisuallyHidden.Root asChild>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <Command
            label={title}
            loop
            shouldFilter={shouldFilter}
            value={value}
            onValueChange={onValueChange}
            className={styles.command}
          >
            <div className={styles.inputRow}>
              <span className={styles.searchIcon} aria-hidden>
                {loading ? <Spinner size="sm" label={null} /> : <Search />}
              </span>
              <Command.Input
                value={search}
                onValueChange={onSearchChange}
                placeholder={placeholder}
                className={styles.input}
              />
              <Kbd keys="esc" size="sm" aria-hidden />
            </div>
            <div className={styles.body}>
              <Command.List className={styles.list} aria-busy={loading || undefined}>
                <SelectionGlide />
                {loading && (
                  <Command.Loading className={styles.loading}>Searching…</Command.Loading>
                )}
                {!loading && <Command.Empty className={styles.empty}>{empty}</Command.Empty>}
                {children}
              </Command.List>
              {aside && <div className={styles.aside}>{aside}</div>}
            </div>
            {!hideFooter && (
              <div className={styles.footer}>
                {footer ?? (
                  <>
                    <span aria-hidden>
                      <Kbd keys={['up']} size="sm" />
                      <Kbd keys={['down']} size="sm" /> navigate
                    </span>
                    <span aria-hidden>
                      <Kbd keys="enter" size="sm" /> select
                    </span>
                    <span aria-hidden>
                      <Kbd keys="esc" size="sm" /> close
                    </span>
                  </>
                )}
              </div>
            )}
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CommandPaletteGroup({ className, ...props }: ComponentProps<typeof Command.Group>) {
  return <Command.Group className={cx(styles.group, className)} {...props} />;
}

export interface CommandPaletteItemProps extends Omit<
  ComponentProps<typeof Command.Item>,
  'children'
> {
  icon?: ReactNode;
  /** Visual shortcut hint (the palette does not bind it). */
  shortcut?: string | string[];
  /** Secondary text shown after the label, e.g. a path or timestamp. */
  hint?: ReactNode;
  /** A second line under the label, e.g. a matching snippet. */
  description?: ReactNode;
  /** A quieter, indented item that belongs to the one above (e.g. more matches in a chat). */
  inset?: boolean;
  children: ReactNode;
}

function CommandPaletteItem({
  icon,
  shortcut,
  hint,
  description,
  inset,
  className,
  children,
  ...props
}: CommandPaletteItemProps) {
  return (
    <Command.Item
      className={cx(styles.item, className)}
      data-description={description != null ? '' : undefined}
      data-inset={inset || undefined}
      {...props}
    >
      {icon != null && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      {description != null ? (
        <span className={styles.text}>
          <span className={styles.line}>
            <span className={styles.label}>{children}</span>
            {hint != null && <span className={styles.hint}>{hint}</span>}
          </span>
          <span className={styles.description}>{description}</span>
        </span>
      ) : (
        <>
          <span className={styles.label}>{children}</span>
          {hint != null && <span className={styles.hint}>{hint}</span>}
        </>
      )}
      {shortcut && <Kbd keys={shortcut} size="sm" aria-hidden />}
    </Command.Item>
  );
}

function CommandPaletteSeparator({
  className,
  ...props
}: ComponentProps<typeof Command.Separator>) {
  return <Command.Separator className={cx(styles.separator, className)} {...props} />;
}

/**
 * ⌘K command palette. Fuzzy search, grouped results, a gliding selection and a
 * stable frame that keeps the search field in place as results filter.
 */
export const CommandPalette = Object.assign(CommandPaletteRoot, {
  Group: CommandPaletteGroup,
  Item: CommandPaletteItem,
  Separator: CommandPaletteSeparator,
});

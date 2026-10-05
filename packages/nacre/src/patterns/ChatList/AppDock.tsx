import { useId, type ComponentProps, type ReactNode } from 'react';

import { ContextMenu } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import appIconStyles from '../ConchApps/AppIcon.module.css';
import { appColor, type AppColor } from '../ConchApps/glyphs';
import { IntegrationLogo, type IntegrationLogoProps } from '../Integrations/IntegrationLogo';
import styles from './AppDock.module.css';
import { CHAT_STATUS_WORDS, type ChatStatus } from './ChatRow';

/** One pinned page in the dock. */
export interface AppDockItem {
  key: string;
  /** The page's name, under its icon. */
  label: string;
  /** An `AppIcon` for a Conch app's page, a `DockGlyph` for anything else. Size `md`. */
  icon: ReactNode;
  /** Where it's from, said with its name: “Page of the Tally app”, “Made in a chat”. */
  source: string;
  /** The page that's open. */
  active?: boolean;
  onOpen: () => void;
  /** `ContextMenu` items (Open, About this app, Unpin), on right-click or a long press. */
  menu?: ReactNode;
  /** Where it is, as a dot on the icon's corner, shown and said. */
  status?: ChatStatus;
}

export interface AppDockProps extends Omit<ComponentProps<'section'>, 'children'> {
  items: AppDockItem[];
  /** The region's name. */
  label?: string;
}

/**
 * Pinned pages, as a dock of app icons at the top of the chat list, so they
 * read as apps and not as chats. Four to a row; the open one has a small dot
 * under it, the way a home screen marks what's running. A press opens it; a
 * right-click (or a long press) has the rest.
 */
export function AppDock({ items, label = 'Pinned apps', className, ...props }: AppDockProps) {
  if (!items.length) return null;
  return (
    <section aria-label={label} className={cx(styles.dock, className)} {...props}>
      <ul className={styles.grid}>
        {items.map(({ key, ...item }) => (
          <li key={key} className={styles.cell}>
            <AppDockTile {...item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface AppDockTileProps
  extends
    Omit<AppDockItem, 'key'>,
    Omit<ComponentProps<'button'>, 'children' | 'onClick' | 'type'> {}

/** One tile of the dock: the icon, the name under it, and where it's from in a tooltip. */
export function AppDockTile({
  label,
  icon,
  source,
  active,
  onOpen,
  menu,
  status,
  className,
  ...props
}: AppDockTileProps) {
  const id = useId();
  const tile = (
    <button
      type="button"
      aria-label={label}
      aria-describedby={`${id}-source`}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      className={cx(styles.tile, className)}
      onClick={onOpen}
      {...props}
    >
      <span className={styles.icon} aria-hidden>
        {icon}
        {status && <span className={styles.status} data-status={status} />}
      </span>
      <span className={styles.label} aria-hidden>
        {label}
      </span>
      <span id={`${id}-source`} className="nc-visually-hidden">
        {source}
        {status ? `, ${CHAT_STATUS_WORDS[status]}` : ''}
      </span>
      <span className={styles.running} aria-hidden />
    </button>
  );

  const withMenu = menu ? (
    <ContextMenu.Root>
      <Tooltip content={`${label} · ${source}`} side="bottom">
        <ContextMenu.Trigger asChild>{tile}</ContextMenu.Trigger>
      </Tooltip>
      <ContextMenu.Content>{menu}</ContextMenu.Content>
    </ContextMenu.Root>
  ) : (
    <Tooltip content={`${label} · ${source}`} side="bottom">
      {tile}
    </Tooltip>
  );
  return withMenu;
}

export interface DockGlyphProps extends Omit<ComponentProps<'span'>, 'children' | 'color'> {
  /** A Lucide icon that says what the page is: a chart, a document, a list. */
  icon: ReactNode;
  /** The tile's colour. Slate, unless the page has a colour of its own. */
  color?: AppColor;
  size?: IntegrationLogoProps['size'];
  /** The page's name for screen readers; leave it out when the name is beside it. */
  label?: string;
}

/**
 * A pinned page that isn't a Conch app (something made in a chat), drawn as
 * the same glazed tile an app's icon is, so the dock reads as one row of
 * apps.
 */
export function DockGlyph({
  icon,
  color = 'slate',
  size = 'md',
  label,
  className,
  ...props
}: DockGlyphProps) {
  return (
    <IntegrationLogo
      name={label ?? ''}
      decorative={!label}
      icon={icon}
      size={size}
      data-app-color={appColor(color)}
      className={cx(appIconStyles.icon, className)}
      {...props}
    />
  );
}

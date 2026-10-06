import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { ContextMenu } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import appIconStyles from '../ConchApps/AppIcon.module.css';
import { appColor, type AppColor } from '../ConchApps/glyphs';
import { IntegrationLogo, type IntegrationLogoProps } from '../Integrations/IntegrationLogo';
import styles from './AppDock.module.css';
import { AppFolder, type AppFolderOrigin } from './AppFolder';
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
  /** The quiet heading over the icons. */
  heading?: string;
  /**
   * How many tiles the sidebar shows (two rows of four). With more apps than
   * that, the last place is **All apps**, a folder of the rest that opens all
   * of them, with a search.
   */
  inline?: number;
  /**
   * The order the row shows them in, when it isn't the folder's: the ones a
   * person reaches for first. The same apps, rearranged — the folder keeps
   * `items` as they are, so nothing moves about inside it.
   */
  order?: AppDockItem[];
  /** At the folder's foot: a way to the place that manages them (Open Apps). */
  folderActions?: ReactNode;
  /** The folder open or closed, when the app holds it. */
  folderOpen?: boolean;
  onFolderOpenChange?: (open: boolean) => void;
}

/** What matters most on a tile hidden in the folder, shown on the folder's own corner. */
const STATUS_WEIGHT: Record<ChatStatus, number> = { error: 4, waiting: 3, working: 2, unread: 1 };

/**
 * Pinned pages, as a dock of app icons at the top of the chat list, so they
 * read as apps and not as chats, under a quiet **Apps** heading. Four to a
 * row; the open one has a small dot under it, the way a home screen marks
 * what's running. A press opens it; a right-click (or a long press) has the
 * rest. Past two rows, the last tile is a folder (`AppFolder`) holding every
 * app, the way a phone keeps a folder on its home screen.
 */
export function AppDock({
  items,
  label = 'Pinned apps',
  heading = 'Apps',
  inline = 8,
  order,
  folderActions,
  folderOpen,
  onFolderOpenChange,
  className,
  ...props
}: AppDockProps) {
  const headingId = useId();
  const [openState, setOpenState] = useState(false);
  const [origin, setOrigin] = useState<AppFolderOrigin>();
  const open = folderOpen ?? openState;
  const setOpen = (next: boolean) => {
    if (folderOpen === undefined) setOpenState(next);
    onFolderOpenChange?.(next);
  };

  if (!items.length) return null;
  const row = order?.length === items.length ? order : items;
  const overflow = items.length > Math.max(1, inline);
  const shown = overflow ? row.slice(0, Math.max(1, inline) - 1) : row;
  const rest = overflow ? row.slice(shown.length) : [];

  return (
    <section
      aria-label={label}
      className={cx(styles.dock, className)}
      data-overflow={overflow || undefined}
      {...props}
    >
      <div className={styles.head}>
        <span id={headingId} className={styles.heading}>
          {heading}
        </span>
      </div>
      <ul className={styles.grid} aria-labelledby={headingId}>
        {shown.map(({ key, ...item }) => (
          <li key={key} className={styles.cell}>
            <AppDockTile {...item} />
          </li>
        ))}
        {overflow && (
          <li className={styles.cell}>
            <AppFolderTile
              rest={rest}
              total={items.length}
              expanded={open}
              onOpen={(at) => {
                setOrigin(at);
                setOpen(true);
              }}
            />
          </li>
        )}
      </ul>
      {overflow && (
        <AppFolder
          open={open}
          onOpenChange={setOpen}
          items={items}
          title={heading}
          origin={origin}
          actions={folderActions}
        />
      )}
    </section>
  );
}

/**
 * The dock's last tile when there are more apps than fit: the first few of the
 * rest in miniature, on one glazed tile, like a folder on a phone. It wears
 * the most pressing dot among them, and the running dot when the open page is
 * inside.
 */
function AppFolderTile({
  rest,
  total,
  expanded,
  onOpen,
}: {
  rest: AppDockItem[];
  total: number;
  expanded: boolean;
  onOpen: (origin: AppFolderOrigin) => void;
}) {
  const id = useId();
  const status = rest
    .map((item) => item.status)
    .filter((s): s is ChatStatus => Boolean(s))
    .sort((a, b) => STATUS_WEIGHT[b] - STATUS_WEIGHT[a])[0];
  const active = rest.some((item) => item.active);
  const more = rest.length;
  return (
    <Tooltip content={`All ${total} apps`} side="bottom">
      <button
        type="button"
        className={styles.tile}
        data-folder=""
        data-active={active || undefined}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-describedby={`${id}-more`}
        onClick={(e) => {
          const box = e.currentTarget.querySelector('[data-folder-art]') ?? e.currentTarget;
          const rect = box.getBoundingClientRect();
          onOpen({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }}
      >
        <span className={cx(styles.icon, styles.folderIcon)} data-folder-art="" aria-hidden>
          {rest.slice(0, 9).map((item) => (
            <span key={item.key} className={styles.mini}>
              <span className={styles.miniArt}>{item.icon}</span>
            </span>
          ))}
          {status && <span className={styles.status} data-status={status} />}
        </span>
        <span className={styles.label}>All apps</span>
        <span id={`${id}-more`} className="nc-visually-hidden">
          {`${more} more, ${total} in all`}
          {status ? `, ${CHAT_STATUS_WORDS[status]}` : ''}
        </span>
        <span className={styles.running} aria-hidden />
      </button>
    </Tooltip>
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

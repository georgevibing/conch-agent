import { ChevronRight } from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './ChatList.module.css';
import { isChatDrag, readChatDrag } from './drag';

export interface ChatListSectionProps extends Omit<
  ComponentProps<'section'>,
  'children' | 'onDrop'
> {
  /** What the group is, as a person says it: “Today”, “Pinned”, “Work”. Names the region too. */
  label: string;
  /** A small mark before the label, such as a folder's `FolderMark`. */
  icon?: ReactNode;
  /** How many chats are in it. Shown, quietly, while it's folded away (or always, with `showCount`). */
  count?: number;
  /** Show `count` while open too. */
  showCount?: boolean;
  /** The label folds the group away and back. */
  collapsible?: boolean;
  /** Open or folded, when the app holds it (a folder remembers). */
  open?: boolean;
  /** Open or folded to begin with. Open unless told otherwise. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Small buttons at the end of the label (a folder's ⋯). They show on hover and focus, and always on touch. */
  actions?: ReactNode;
  /**
   * Chats dropped on the group. Giving this makes the whole group a place to
   * drop dragged chats: it lights up while they're over it.
   */
  onDropChats?: (ids: string[]) => void;
  /** Said beside the label while chats are over it: “Drop to pin”, “Move to Work”. */
  dropHint?: string;
  /** The rows (`ChatRow`s). */
  children?: ReactNode;
}

/**
 * A group in the chat list: a quiet label over its rows. Pinned, a folder,
 * or a stretch of time (“Today”, “September”). A folder's label folds it
 * away, keeping how many chats are inside beside it. A group that takes
 * chats lights up as they're dragged over it, and says what letting go will
 * do.
 */
export function ChatListSection({
  label,
  icon,
  count,
  showCount,
  collapsible,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  actions,
  onDropChats,
  dropHint,
  children,
  className,
  ...props
}: ChatListSectionProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = collapsible ? (openProp ?? openState) : true;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const { over, ready, handlers } = useChatDrop(onDropChats);
  const counted = count !== undefined && (showCount || !open);

  const heading = (
    <>
      {icon && (
        <span className={styles.sectionIcon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={styles.sectionLabel}>{label}</span>
      {counted && (
        <>
          <span className={styles.sectionCount} aria-hidden>
            {count}
          </span>
          <span className="nc-visually-hidden">
            , {count} {count === 1 ? 'chat' : 'chats'}
          </span>
        </>
      )}
      {collapsible && <ChevronRight className={styles.sectionChevron} aria-hidden />}
    </>
  );

  const head = (
    <div className={styles.sectionHead}>
      {collapsible ? (
        <CollapsiblePrimitive.Trigger className={styles.sectionToggle}>
          {heading}
        </CollapsiblePrimitive.Trigger>
      ) : (
        <span className={styles.sectionTitle}>{heading}</span>
      )}
      {actions && <span className={styles.sectionActions}>{actions}</span>}
      {/* Shown (and so read) only while chats are over the group. */}
      {onDropChats && dropHint && <span className={styles.dropHint}>{dropHint}</span>}
    </div>
  );

  const list = <ul className={styles.sectionList}>{children}</ul>;

  return (
    <section
      aria-label={label}
      data-collapsible={collapsible || undefined}
      data-state={collapsible ? (open ? 'open' : 'closed') : undefined}
      data-drop-ready={ready || undefined}
      data-drop-over={over || undefined}
      className={cx(styles.section, className)}
      {...handlers}
      {...props}
    >
      {collapsible ? (
        <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen}>
          {head}
          <CollapsiblePrimitive.Content className={styles.sectionContent}>
            {list}
          </CollapsiblePrimitive.Content>
        </CollapsiblePrimitive.Root>
      ) : (
        <>
          {head}
          {list}
        </>
      )}
    </section>
  );
}

/**
 * Makes an element a place to drop chats. `ready` while chats are being
 * dragged anywhere (so places that take them can invite), `over` while
 * they're over this one.
 */
function useChatDrop(onDropChats: ((ids: string[]) => void) | undefined) {
  const [over, setOver] = useState(false);
  const [ready, setReady] = useState(false);
  // dragenter/dragleave fire for every child crossed; count them so the
  // highlight doesn't flicker between rows.
  const depth = useRef(0);
  const enabled = Boolean(onDropChats);

  useEffect(() => {
    if (!enabled) return;
    const start = (e: globalThis.DragEvent) => setReady(isChatDrag(e.dataTransfer));
    const end = () => {
      depth.current = 0;
      setReady(false);
      setOver(false);
    };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end);
    document.addEventListener('drop', end);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end);
      document.removeEventListener('drop', end);
    };
  }, [enabled]);

  if (!onDropChats) return { over: false, ready: false, handlers: {} };

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!isChatDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!isChatDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!isChatDrag(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!isChatDrag(e.dataTransfer)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      setReady(false);
      const ids = readChatDrag(e.dataTransfer);
      if (ids.length) onDropChats(ids);
    },
  };
  return { over, ready, handlers };
}

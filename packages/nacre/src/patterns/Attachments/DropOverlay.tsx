import { FilePlus2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './Attachments.module.css';

export interface DropOverlayProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Files are being dragged over the drop target. */
  active: boolean;
  title?: ReactNode;
  /** What can be dropped, in a few words. */
  hint?: ReactNode;
}

/**
 * What a chat shows while files are dragged over it: the view dims, a pearl
 * halo gathers, and one line says what letting go will do. Place it inside a
 * positioned container; it never takes the pointer, so the drop lands on
 * whatever is underneath.
 */
export function DropOverlay({
  active,
  title = 'Drop to attach',
  hint,
  className,
  ...props
}: DropOverlayProps) {
  return (
    <div
      aria-hidden
      data-active={active || undefined}
      className={cx(styles.drop, className)}
      {...props}
    >
      <div className={styles.dropCard}>
        <span className={styles.dropIcon}>
          <FilePlus2 />
        </span>
        <span className={styles.dropTitle}>{title}</span>
        {hint && <span className={styles.dropHint}>{hint}</span>}
      </div>
    </div>
  );
}

/** Carries files, not a dragged link or text selection. */
function hasFiles(event: DragEvent | globalThis.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export interface FileDrop {
  files: File[];
  /** Names of folders that were dropped; they can't be attached as they are. */
  folders: string[];
}

export interface UseFileDropOptions {
  onDrop: (drop: FileDrop) => void;
  disabled?: boolean;
}

/**
 * Drag-and-drop for files over an area. Spread `props` on the area and show
 * `DropOverlay` while `dragging`. Dragged text and links are left alone.
 *
 * While mounted it also stops the browser from opening a file dropped just
 * outside the area, which would navigate away from the chat and lose the
 * draft.
 */
export function useFileDrop({ onDrop, disabled = false }: UseFileDropOptions) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const latest = useRef(onDrop);
  useEffect(() => {
    latest.current = onDrop;
  });

  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  // A drag that leaves the window (or is cancelled with Esc) never fires `drop`.
  useEffect(() => {
    if (!dragging) return;
    const reset = () => {
      depth.current = 0;
      setDragging(false);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, [dragging]);

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const onDragLeave = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDropEvent = useCallback(
    (event: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      const folders: string[] = [];
      const files: File[] = [];
      const items = Array.from(event.dataTransfer.items ?? []);
      if (items.length) {
        for (const item of items) {
          if (item.kind !== 'file') continue;
          const entry = item.webkitGetAsEntry?.();
          const file = item.getAsFile();
          if (entry?.isDirectory) folders.push(entry.name);
          else if (file) files.push(file);
        }
      } else {
        files.push(...Array.from(event.dataTransfer.files));
      }
      if (files.length || folders.length) latest.current({ files, folders });
    },
    [disabled],
  );

  return {
    dragging: dragging && !disabled,
    props: { onDragEnter, onDragOver, onDragLeave, onDrop: onDropEvent },
  };
}

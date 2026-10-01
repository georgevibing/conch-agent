import { FilePen, Redo2, Undo2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Undo.module.css';

export interface FilesChangedProps extends Omit<ComponentProps<'div'>, 'children'> {
  files: { path: string; kind: 'created' | 'changed' | 'deleted' }[];
  state: 'applied' | 'undone' | 'expired';
  onUndo?: () => void;
  onRedo?: () => void;
  /** "Undo all 3 changes from this turn", when the turn made more than one. */
  turn?: ReactNode;
}

const VERB = { created: 'Made', changed: 'Changed', deleted: 'Deleted' } as const;

/**
 * A quiet line after the assistant changes files (ADR 0030): what it touched,
 * and the one press that puts it back. Undone, it says so and offers Redo.
 */
export function FilesChanged({
  files,
  state,
  onUndo,
  onRedo,
  turn,
  className,
  ...props
}: FilesChangedProps) {
  const first = files[0];
  const summary =
    files.length === 1 && first
      ? `${VERB[first.kind]} ${first.path}`
      : `${files.length} files: ${files
          .slice(0, 3)
          .map((f) => f.path)
          .join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`;
  return (
    <div className={cx(styles.line, className)} data-state={state} {...props}>
      <FilePen aria-hidden className={styles.lineIcon} />
      <span className={styles.lineText}>
        {state === 'undone' ? <span className={styles.undone}>Undone · </span> : null}
        {summary}
      </span>
      {state === 'applied' && onUndo && (
        <Button size="sm" variant="ghost" leadingIcon={<Undo2 />} onClick={onUndo}>
          Undo
        </Button>
      )}
      {state === 'undone' && onRedo && (
        <Button size="sm" variant="ghost" leadingIcon={<Redo2 />} onClick={onRedo}>
          Redo
        </Button>
      )}
      {state === 'expired' && <span className={styles.quiet}>Too old to undo</span>}
      {turn}
    </div>
  );
}

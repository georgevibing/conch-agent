import { FileMinus, FilePen, FilePlus, TriangleAlert } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Diff } from '../Diff';
import { cx } from '../../utils/cx';
import styles from './Undo.module.css';

export interface UndoPreviewItem {
  /** "notes.md", "~/.zshrc". */
  path: string;
  /** What happens to it. */
  action: 'restore' | 'remove' | 'recreate';
  diff?: string;
  binary?: boolean;
  /** It changed since: one sentence. Only replaced when the person says so. */
  conflict?: string;
  /** It can't be put back at all: one sentence. */
  blocked?: string;
}

export interface UndoPreviewProps extends Omit<ComponentProps<'div'>, 'children'> {
  files: UndoPreviewItem[];
  direction: 'undo' | 'redo';
}

const WORDS = {
  undo: {
    restore: 'Goes back to how it was',
    remove: 'Removed: the assistant made it',
    recreate: 'Comes back: the assistant deleted it',
  },
  redo: { restore: 'Changed again', remove: 'Removed again', recreate: 'Made again' },
} as const;

const ICONS = { restore: FilePen, remove: FileMinus, recreate: FilePlus } as const;

/**
 * Exactly what Undo (or Redo) will do, before it does it (ADR 0030): each
 * file, what happens to it, the change as a diff, and anything in the way —
 * a file you changed since, or one that can't be put back.
 */
export function UndoPreview({ files, direction, className, ...props }: UndoPreviewProps) {
  return (
    <div className={cx(styles.preview, className)} {...props}>
      {files.map((file) => {
        const Icon = ICONS[file.action];
        return (
          <section
            key={file.path}
            className={styles.file}
            aria-label={file.path}
            data-blocked={file.blocked ? '' : undefined}
          >
            <div className={styles.fileHead}>
              <Icon aria-hidden className={styles.fileIcon} />
              <code className={styles.filePath}>{file.path}</code>
              <span className={styles.fileWhat}>{WORDS[direction][file.action]}</span>
            </div>
            {(file.blocked ?? file.conflict) && (
              <p className={styles.note} data-kind={file.blocked ? 'blocked' : 'conflict'}>
                <TriangleAlert aria-hidden />
                <span>{file.blocked ?? file.conflict}</span>
              </p>
            )}
            {!file.blocked &&
              (file.diff ? (
                <Diff diff={file.diff} header={false} lineNumbers={false} />
              ) : file.binary ? (
                <p className={styles.quiet}>
                  Not text, so there’s no preview. It’s put back exactly as it was.
                </p>
              ) : file.action !== 'remove' ? (
                <p className={styles.quiet}>
                  Too big to show here. It’s put back exactly as it was.
                </p>
              ) : null)}
          </section>
        );
      })}
    </div>
  );
}

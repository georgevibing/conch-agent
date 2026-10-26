import { ShieldCheck, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './AutoLearned.module.css';

export interface AllowedRow {
  id: string;
  /** What Auto no longer asks about: "push code to a remote", or a command. */
  words: ReactNode;
  /** Its × in words, for a screen reader: "Ask again before it would push code to a remote". */
  forget: string;
  /** Where it holds, when not everywhere: a work folder's name. */
  where?: string;
}

export interface AllowedListProps extends Omit<ComponentProps<'ul'>, 'children'> {
  rows: AllowedRow[];
  onForget: (id: string) => void;
  /** The words are a command: drawn as code. */
  code?: boolean;
}

/**
 * What Auto never asks about again, in any chat (ADR 0128, ADR 0149): one quiet row each,
 * with an × that forgets it. Forgetting only makes Auto ask again, so it needs no second
 * look. Nothing when there's nothing.
 */
export function AllowedList({ rows, onForget, code, className, ...props }: AllowedListProps) {
  if (!rows.length) return null;
  return (
    <ul className={cx(styles.allowed, className)} {...props}>
      {rows.map((row) => (
        <li key={row.id} className={styles.row}>
          <ShieldCheck aria-hidden className={styles.rowIcon} />
          <span className={styles.rowWords} data-code={code ? '' : undefined}>
            {code ? <code>{row.words}</code> : row.words}
          </span>
          {row.where && <span className={styles.rowWhere}>{row.where}</span>}
          <IconButton size="sm" label={row.forget} onClick={() => onForget(row.id)}>
            <X />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { parseDelimited } from '../Attachments/fileType';
import styles from './Artifacts.module.css';

export interface ArtifactTableProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** CSV (or TSV) with a header row. */
  csv: string;
  /** What the table is, for screen readers: "Budget". */
  label: string;
  maxRows?: number;
  /** A small picture of it, as a chat card shows it: the first rows, nothing to press. */
  compact?: boolean;
}

const number = (cell: string) => {
  const clean = cell.replace(/[\s,€$£¥%]/g, '');
  return clean !== '' && Number.isFinite(Number(clean)) ? Number(clean) : undefined;
};

/**
 * A table the assistant made: a header that stays put, numbers aligned for
 * reading down, and every column sortable by its heading.
 */
export function ArtifactTable({
  csv,
  label,
  maxRows = 2000,
  compact,
  className,
  ...props
}: ArtifactTableProps) {
  const rows = useMemo(() => {
    const first = csv.split(/\r?\n/, 1)[0] ?? '';
    const delimiter =
      first.includes('\t') && !first.includes(',')
        ? '\t'
        : first.includes(';') && !first.includes(',')
          ? ';'
          : ',';
    return parseDelimited(csv.trim(), delimiter, maxRows + 1);
  }, [csv, maxRows]);
  const [sort, setSort] = useState<{ column: number; dir: 'ascending' | 'descending' }>();
  const header = rows[0] ?? [];
  const body = useMemo(() => rows.slice(1, maxRows + 1), [rows, maxRows]);
  const numeric = header.map(
    (_, c) =>
      body.length > 0 && body.every((r) => (r[c] ?? '') === '' || number(r[c] ?? '') !== undefined),
  );
  const sorted = useMemo(() => {
    if (!sort) return body;
    const { column, dir } = sort;
    const sign = dir === 'ascending' ? 1 : -1;
    return [...body].sort((x, y) => {
      const a = x[column] ?? '';
      const b = y[column] ?? '';
      const na = number(a);
      const nb = number(b);
      if (na !== undefined && nb !== undefined) return (na - nb) * sign;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * sign;
    });
  }, [body, sort]);

  return (
    <div
      className={cx(styles.tableWrap, className)}
      data-compact={compact || undefined}
      // Scrollable regions must be keyboard-focusable (WCAG 2.1.1); a compact one doesn't scroll.
      tabIndex={compact ? undefined : 0}
      role="region"
      aria-label={label}
      {...props}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            {header.map((name, c) => {
              const dir = sort?.column === c ? sort.dir : undefined;
              const Icon =
                dir === 'ascending' ? ArrowUp : dir === 'descending' ? ArrowDown : ArrowUpDown;
              return (
                <th
                  key={c}
                  scope="col"
                  aria-sort={dir ?? 'none'}
                  data-numeric={numeric[c] || undefined}
                >
                  {compact ? (
                    name || `Column ${c + 1}`
                  ) : (
                    <button
                      type="button"
                      className={styles.sort}
                      onClick={() =>
                        setSort(
                          dir === 'ascending'
                            ? { column: c, dir: 'descending' }
                            : dir === 'descending'
                              ? undefined
                              : { column: c, dir: 'ascending' },
                        )
                      }
                    >
                      {name || `Column ${c + 1}`}
                      <Icon
                        aria-hidden
                        className={styles.sortIcon}
                        data-active={dir ? true : undefined}
                      />
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, r) => (
            <tr key={r}>
              {header.map((_, c) => (
                <td key={c} data-numeric={numeric[c] || undefined}>
                  {row[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && rows.length > maxRows + 1 && (
        <p className={styles.more}>
          Showing the first {maxRows.toLocaleString('en')} rows. Download it for the rest.
        </p>
      )}
    </div>
  );
}

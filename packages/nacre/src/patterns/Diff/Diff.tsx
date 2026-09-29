import { FileDiff } from 'lucide-react';
import { useMemo, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Diff.module.css';

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

/** Parse a unified diff (`git diff` / `diff -u` output) into typed lines. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldN = 0;
  let newN = 0;
  for (const raw of diff.replace(/\n$/, '').split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(raw)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      lines.push({ kind: 'hunk', text: raw });
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), newNumber: newN++ });
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1), oldNumber: oldN++ });
    } else if (raw.startsWith('\\')) {
      lines.push({ kind: 'meta', text: raw.slice(2) });
    } else {
      lines.push({
        kind: 'context',
        text: raw.startsWith(' ') ? raw.slice(1) : raw,
        oldNumber: oldN++,
        newNumber: newN++,
      });
    }
  }
  return lines;
}

export interface DiffStatProps extends ComponentProps<'span'> {
  additions: number;
  deletions: number;
}

/** "+12 −3" with a five-block ratio bar. */
export function DiffStat({ additions, deletions, className, ...props }: DiffStatProps) {
  const total = additions + deletions;
  const addBlocks = total === 0 ? 0 : Math.round((additions / total) * 5);
  return (
    <span className={cx(styles.stat, className)} {...props}>
      <span className="nc-visually-hidden">
        {additions} additions, {deletions} deletions
      </span>
      <span className={styles.statAdd} aria-hidden>
        +{additions}
      </span>
      <span className={styles.statDel} aria-hidden>
        −{deletions}
      </span>
      <span className={styles.blocks} aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            data-kind={total === 0 ? 'none' : i < addBlocks ? 'add' : 'del'}
            className={styles.block}
          />
        ))}
      </span>
    </span>
  );
}

export interface DiffProps extends Omit<ComponentProps<'figure'>, 'children'> {
  /** Unified diff text, or pre-parsed lines. */
  diff: string | DiffLine[];
  filename?: string;
  /** Show old/new line-number gutters. */
  lineNumbers?: boolean;
  /** Hide the file header (e.g. when embedded in a ToolCall that already names the file). */
  header?: boolean;
}

const markers: Record<DiffLineKind, string> = {
  add: '+',
  del: '−',
  context: ' ',
  hunk: '',
  meta: '',
};

/** Compact, readable unified diff for file edits. */
export function Diff({
  diff,
  filename,
  lineNumbers = true,
  header = true,
  className,
  ...props
}: DiffProps) {
  const lines = useMemo(() => (typeof diff === 'string' ? parseUnifiedDiff(diff) : diff), [diff]);
  const additions = lines.filter((l) => l.kind === 'add').length;
  const deletions = lines.filter((l) => l.kind === 'del').length;

  return (
    <figure
      className={cx(styles.root, className)}
      data-line-numbers={lineNumbers || undefined}
      {...props}
    >
      {header && (
        <figcaption className={styles.header}>
          <FileDiff aria-hidden className={styles.headerIcon} />
          <span className={styles.filename}>{filename ?? 'Changes'}</span>
          <DiffStat additions={additions} deletions={deletions} />
        </figcaption>
      )}
      <div
        className={styles.viewport}
        // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label={filename ? `Diff of ${filename}` : 'Diff'}
      >
        <table className={styles.table}>
          <tbody>
            {lines.map((line, i) =>
              line.kind === 'hunk' || line.kind === 'meta' ? (
                <tr key={i} data-kind={line.kind} className={styles.row}>
                  <td colSpan={lineNumbers ? 4 : 2} className={styles.hunk}>
                    {line.text}
                  </td>
                </tr>
              ) : (
                <tr key={i} data-kind={line.kind} className={styles.row}>
                  {lineNumbers && (
                    <>
                      <td className={styles.num} aria-hidden>
                        {line.oldNumber}
                      </td>
                      <td className={styles.num} aria-hidden>
                        {line.newNumber}
                      </td>
                    </>
                  )}
                  <td className={styles.marker}>
                    <span aria-hidden>{markers[line.kind]}</span>
                    {line.kind !== 'context' && (
                      <span className="nc-visually-hidden">
                        {line.kind === 'add' ? 'added' : 'removed'}
                      </span>
                    )}
                  </td>
                  <td className={styles.text}>{line.text || ' '}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

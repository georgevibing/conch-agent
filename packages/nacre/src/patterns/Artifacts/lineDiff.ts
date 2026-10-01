import type { DiffLine } from '../Diff';

/** Past this many line pairs, the changed middle is shown as removed then added. */
const LIMIT = 2_000_000;

interface Op {
  kind: 'add' | 'del' | 'context';
  text: string;
}

/** Longest common subsequence of two line lists, as edit operations. */
function edits(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > LIMIT)
    return [
      ...a.map((text): Op => ({ kind: 'del', text })),
      ...b.map((text): Op => ({ kind: 'add', text })),
    ];
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  const at = (i: number, j: number) => table[i * w + j] ?? 0;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * w + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: 'context', text: a[i] ?? '' });
      i++;
      j++;
    } else if (j >= m || (i < n && at(i + 1, j) >= at(i, j + 1)))
      ops.push({ kind: 'del', text: a[i++] ?? '' });
    else ops.push({ kind: 'add', text: b[j++] ?? '' });
  }
  return ops;
}

/**
 * What changed between two versions, line by line, as hunks with a little
 * context around each change — ready for `Diff`.
 */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [
    ...a.slice(0, start).map((text): Op => ({ kind: 'context', text })),
    ...edits(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text): Op => ({ kind: 'context', text })),
  ];

  // Number the lines, then keep only changes and the context near them.
  let oldN = 0;
  let newN = 0;
  const numbered = ops.map((op) => ({
    ...op,
    oldNumber: op.kind === 'add' ? undefined : ++oldN,
    newNumber: op.kind === 'del' ? undefined : ++newN,
  }));
  const near = new Uint8Array(numbered.length);
  numbered.forEach((op, k) => {
    if (op.kind === 'context') return;
    for (let d = Math.max(0, k - context); d <= Math.min(numbered.length - 1, k + context); d++)
      near[d] = 1;
  });
  const out: DiffLine[] = [];
  let open = false;
  numbered.forEach((op, k) => {
    if (!near[k]) {
      open = false;
      return;
    }
    if (!open) {
      out.push({ kind: 'hunk', text: `Line ${op.newNumber ?? op.oldNumber ?? 1}` });
      open = true;
    }
    out.push({
      kind: op.kind,
      text: op.text,
      ...(op.oldNumber !== undefined && { oldNumber: op.oldNumber }),
      ...(op.newNumber !== undefined && { newNumber: op.newNumber }),
    });
  });
  return out;
}

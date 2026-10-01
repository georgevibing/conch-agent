/**
 * A unified diff of two texts, for Undo's preview (ADR 0030): Myers' O(ND)
 * line diff with three lines of context, in the format Nacre's `Diff` reads.
 * Gives up (undefined) on texts too big to show usefully.
 */

interface Op {
  kind: 'same' | 'add' | 'del';
  text: string;
}

const MAX_LINES = 20_000;
const MAX_EDITS = 4_000;

/** The shortest edit script from `a` to `b`, or undefined when it's too long to be worth showing. */
function script(a: string[], b: string[]): Op[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d);
    }
  }
  return undefined;
}

function backtrack(
  trace: Int32Array[],
  a: string[],
  b: string[],
  offset: number,
  last: number,
): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = last; d > 0; d--) {
    const v = trace[d] ?? new Int32Array();
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0)) ? k + 1 : k - 1;
    const prevX = v[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', text: a[--x] ?? '' });
      y--;
    }
    if (x === prevX) ops.push({ kind: 'add', text: b[--y] ?? '' });
    else ops.push({ kind: 'del', text: a[--x] ?? '' });
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: 'same', text: a[--x] ?? '' });
    y--;
  }
  return ops.reverse();
}

const split = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

/** `--- a` / `+++ b` and hunks; undefined when nothing differs or it's too big. */
export function unifiedDiff(
  before: string,
  after: string,
  name = 'file',
  context = 3,
): string | undefined {
  if (before === after) return undefined;
  const a = split(before);
  const b = split(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) return undefined;
  const ops = script(a, b);
  if (!ops) return undefined;
  const out = [`--- a/${name}`, `+++ b/${name}`];
  // Old and new line numbers at each op, to start each hunk where it belongs.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 1;
  let n = 1;
  for (const op of ops) {
    oldAt.push(o);
    newAt.push(n);
    if (op.kind !== 'add') o++;
    if (op.kind !== 'del') n++;
  }
  const changed = ops.flatMap((op, i) => (op.kind === 'same' ? [] : [i]));
  const groups: [number, number][] = [];
  for (const i of changed) {
    const last = groups.at(-1);
    if (last && i - last[1] <= context * 2) last[1] = i;
    else groups.push([i, i]);
  }
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length, last + context + 1);
    const slice = ops.slice(from, to);
    const oCount = slice.filter((op) => op.kind !== 'add').length;
    const nCount = slice.filter((op) => op.kind !== 'del').length;
    const oStart = oCount ? (oldAt[from] ?? 1) : (oldAt[from] ?? 1) - 1;
    const nStart = nCount ? (newAt[from] ?? 1) : (newAt[from] ?? 1) - 1;
    out.push(`@@ -${oStart},${oCount} +${nStart},${nCount} @@`);
    for (const op of slice)
      out.push(`${op.kind === 'same' ? ' ' : op.kind === 'add' ? '+' : '-'}${op.text}`);
  }
  return out.join('\n');
}

/** Bytes that aren't text: a NUL in the first few kilobytes. */
export function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8_000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

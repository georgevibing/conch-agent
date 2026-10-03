/**
 * A dependency-free rehype plugin for streamed Markdown: wraps every word in a
 * `<span>` so React keeps each word's element stable between renders, and
 * marks words at or after `freshFrom` (a source offset) with `data-nc-fresh`,
 * which plays Nacre's "settle" reveal once as the word mounts.
 *
 *   <ReactMarkdown rehypePlugins={[[revealWords, { freshFrom }]]}>
 *
 * Code (`pre`, `code`) is left untouched.
 */

interface HastText {
  type: 'text';
  value: string;
  position?: { start: { offset?: number } };
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

export interface RevealWordsOptions {
  /** Source offset where fresh words begin; `null` or omitted marks none. */
  freshFrom?: number | null;
  /**
   * When the word at a source offset was revealed (`useSmoothText`'s
   * `revealedAt`). Stamped on each fresh word as `data-nc-at`, so
   * `useSettleOnce` never lets a remounted word settle twice.
   */
  revealedAt?: (offset: number) => number | undefined;
  /** Added to every node's source offset (when rendering one block of a larger text). */
  offset?: number;
}

const SKIP = new Set(['pre', 'code', 'script', 'style', 'svg', 'math']);

type RevealedAt = RevealWordsOptions['revealedAt'];

function split(
  node: HastText,
  freshFrom: number | null,
  offset: number,
  revealedAt: RevealedAt,
): HastNode[] {
  const start = (node.position?.start.offset ?? Number.NaN) + offset;
  const out: HastNode[] = [];
  for (const match of node.value.matchAll(/\s+|\S+\s*/g)) {
    const text = match[0];
    if (/^\s+$/.test(text)) {
      out.push({ type: 'text', value: text });
      continue;
    }
    const at = start + match.index;
    const fresh = freshFrom !== null && (Number.isNaN(at) || at >= freshFrom);
    const when = fresh && !Number.isNaN(at) ? revealedAt?.(at) : undefined;
    out.push({
      type: 'element',
      tagName: 'span',
      properties: fresh
        ? { dataNcFresh: '', ...(when !== undefined && { dataNcAt: String(Math.round(when)) }) }
        : {},
      children: [{ type: 'text', value: text }],
    });
  }
  return out;
}

function walk(node: HastNode, freshFrom: number | null, offset: number, revealedAt: RevealedAt) {
  if (!('children' in node) || !node.children) return;
  if (node.type === 'element' && SKIP.has((node as HastElement).tagName)) return;
  const original = node.children;
  for (const child of original)
    if (child.type === 'element') walk(child, freshFrom, offset, revealedAt);
  node.children = original.flatMap((child) =>
    child.type === 'text' ? split(child as HastText, freshFrom, offset, revealedAt) : [child],
  );
}

export function revealWords(options: RevealWordsOptions = {}) {
  const freshFrom = options.freshFrom ?? null;
  const offset = options.offset ?? 0;
  return (tree: unknown) => {
    walk(tree as HastNode, freshFrom, offset, options.revealedAt);
  };
}

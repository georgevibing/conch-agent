import { createSlugger } from '../site/text';

/** As much of a Markdown tree as this plugin touches. */
interface Node {
  type: string;
  value?: string;
  ordered?: boolean | null;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

export interface RemarkConchOptions {
  /** Anchors already taken by headings earlier on the page (`segments`). */
  seen?: [string, number][];
}

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

const textOf = (node: Node): string => node.value ?? (node.children ?? []).map(textOf).join('');

/** `<kbd>⌘</kbd>` arrives as three nodes (tag, text, tag): make it one element. */
function keys(children: Node[]): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as Node;
    const text = children[i + 1];
    const close = children[i + 2];
    if (
      node.type === 'html' &&
      node.value === '<kbd>' &&
      text?.type === 'text' &&
      close?.type === 'html' &&
      close.value === '</kbd>'
    ) {
      out.push({ type: 'kbd', children: [text], data: { hName: 'kbd' } });
      i += 2;
    } else if (node.type !== 'html') out.push(node);
    // Any other raw HTML is left out: these pages are Markdown, and it would show as text.
  }
  return out;
}

function walk(node: Node, top: boolean, slug: (text: string) => string) {
  if (!node.children) return;
  if (node.children.some((child) => child.type === 'html')) node.children = keys(node.children);

  for (const child of node.children) {
    // Every heading gets the anchor GitHub would give it.
    if (child.type === 'heading') child.data = { hProperties: { id: slug(textOf(child)) } };
    // Numbered lists straight on the page are instructions: draw them as steps.
    if (top && child.type === 'list' && child.ordered) {
      child.data = { hProperties: { 'data-steps': '' } };
      for (const item of child.children ?? []) item.data = { hProperties: { 'data-step': '' } };
    }
    // GitHub's `> [!NOTE]` becomes a callout, here as there.
    if (child.type === 'blockquote') {
      const first = child.children?.[0]?.children?.[0];
      const kind = first?.type === 'text' ? ALERT.exec(first.value ?? '')?.[1] : undefined;
      if (first && kind) {
        first.value = (first.value ?? '').replace(ALERT, '');
        child.data = { hName: 'conch-callout', hProperties: { kind: kind.toLowerCase() } };
      }
    }
    walk(child, false, slug);
  }
}

/**
 * The few things these pages ask of Markdown beyond what GitHub draws, each
 * written so GitHub still reads the file well: keys as `<kbd>`, notes as
 * `> [!NOTE]`, numbered lists as steps, and an anchor on every heading.
 * (Generated parts, written as `<!-- conch:… -->`, are taken out before
 * Markdown sees them: `segments`.)
 */
export function remarkConch({ seen = [] }: RemarkConchOptions = {}) {
  return (tree: unknown) => walk(tree as Node, true, createSlugger(new Map(seen)));
}

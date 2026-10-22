/**
 * What the preview draws for a file the browser can't show by itself: plain
 * data, the same shape as `AttachmentView` in `@conch/protocol` (the gateway
 * makes it from its readers). Nothing in it is ever drawn as HTML.
 */

/** A line of a document. `pre` keeps its spacing; with a `language` it's highlighted. */
export interface AttachmentViewBlock {
  kind: 'heading' | 'paragraph' | 'item' | 'quote' | 'pre';
  text: string;
  language?: string;
}

export type AttachmentViewPart =
  | { kind: 'text'; title?: string; blocks: AttachmentViewBlock[] }
  | { kind: 'table'; title?: string; columns: string[]; rows: string[][]; total?: number }
  | {
      kind: 'tree';
      title?: string;
      entries: { path: string; size?: number; folder?: boolean }[];
      total?: number;
    }
  | {
      kind: 'email';
      title?: string;
      headers: { name: string; value: string }[];
      body: string;
      attachments: { name: string; size?: number; type?: string }[];
    }
  | { kind: 'transcript'; title?: string; segments: { start?: number; text: string }[] }
  | { kind: 'facts'; title?: string; facts: { label: string; value: string }[] };

export interface AttachmentViewData {
  /** What it is, in a sentence: "A ZIP archive of 14 files." */
  summary?: string;
  parts: AttachmentViewPart[];
  /** The preview shows only the start. */
  more?: boolean;
}

/** A cell's source: notebooks keep it as one string or a list of lines. */
function source(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('');
  return '';
}

const MARKDOWN_LINE = /^\s*(#{1,6})\s+(.*)$|^\s*(?:[-*+]|\d+[.)])\s+(.*)$|^\s*>\s?(.*)$/;

/** A Markdown cell's lines, as words: headings, items and quotes, never markup. */
function markdownBlocks(text: string): AttachmentViewBlock[] {
  const blocks: AttachmentViewBlock[] = [];
  let fence: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fence) blocks.push({ kind: 'pre', text: fence.join('\n') });
      fence = fence ? undefined : [];
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const m = MARKDOWN_LINE.exec(line);
    const plain = (s: string) =>
      s
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]+/g, '')
        .trim();
    if (m?.[1]) blocks.push({ kind: 'heading', text: plain(m[2] ?? '') });
    else if (m?.[3] !== undefined) blocks.push({ kind: 'item', text: plain(m[3]) });
    else if (m?.[4] !== undefined) blocks.push({ kind: 'quote', text: plain(m[4]) });
    else blocks.push({ kind: 'paragraph', text: plain(line) });
  }
  if (fence?.length) blocks.push({ kind: 'pre', text: fence.join('\n') });
  return blocks.filter((b) => b.text);
}

/**
 * A Jupyter notebook's cells, read in the browser: its notes as words, its
 * code highlighted, and what each cell printed as plain text. Pictures and
 * HTML a cell made are named, never drawn. Undefined when it isn't one.
 */
export function notebookView(text: string, maxCells = 400): AttachmentViewData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { cells?: unknown }).cells)
  )
    return undefined;
  const book = parsed as {
    cells: unknown[];
    metadata?: { language_info?: { name?: unknown }; kernelspec?: { language?: unknown } };
  };
  const language =
    [book.metadata?.language_info?.name, book.metadata?.kernelspec?.language].find(
      (l): l is string => typeof l === 'string',
    ) ?? 'python';
  const blocks: AttachmentViewBlock[] = [];
  let code = 0;
  for (const raw of book.cells.slice(0, maxCells)) {
    if (!raw || typeof raw !== 'object') continue;
    const cell = raw as { cell_type?: unknown; source?: unknown; outputs?: unknown };
    const body = source(cell.source);
    if (cell.cell_type === 'markdown') blocks.push(...markdownBlocks(body));
    else if (cell.cell_type === 'code') {
      code++;
      if (body.trim()) blocks.push({ kind: 'pre', text: body, language });
      for (const out of Array.isArray(cell.outputs) ? cell.outputs : []) {
        if (!out || typeof out !== 'object') continue;
        const o = out as {
          text?: unknown;
          data?: Record<string, unknown>;
          ename?: unknown;
          evalue?: unknown;
        };
        const printed =
          source(o.text) ||
          source(o.data?.['text/plain']) ||
          (typeof o.ename === 'string' ? `${o.ename}: ${source(o.evalue)}` : '');
        if (printed.trim()) blocks.push({ kind: 'pre', text: printed.slice(0, 20_000) });
        else if (o.data && Object.keys(o.data).some((k) => k.startsWith('image/')))
          blocks.push({ kind: 'quote', text: 'A picture this cell made' });
      }
    } else if (body.trim()) blocks.push({ kind: 'pre', text: body });
  }
  const cells = book.cells.length;
  return {
    summary: `A notebook of ${cells} ${cells === 1 ? 'cell' : 'cells'}, ${code} with code.`,
    parts: [{ kind: 'text', blocks }],
    ...(cells > maxCells && { more: true }),
  };
}

/** A recording's time as people read it: 0:05, 12:30, 1:02:03. */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export interface TreeNode {
  name: string;
  path: string;
  size?: number;
  folder: boolean;
  children: TreeNode[];
}

/** An archive's paths as folders and files, folders first, each level by name. */
export function treeOf(entries: { path: string; size?: number; folder?: boolean }[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', folder: true, children: [] };
  for (const entry of entries) {
    const parts = entry.path.split(/[\\/]+/).filter(Boolean);
    let node = root;
    parts.forEach((name, i) => {
      const last = i === parts.length - 1;
      const folder = !last || Boolean(entry.folder) || entry.path.endsWith('/');
      let child = node.children.find((c) => c.name === name && c.folder === folder);
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join('/'), folder, children: [] };
        node.children.push(child);
      }
      if (last && entry.size !== undefined && !folder) child.size = entry.size;
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
    for (const n of nodes) sort(n.children);
  };
  sort(root.children);
  return root.children;
}

/** Helpers for rendering a reply while it streams. Pure, so they're cheap to test. */

export interface Block {
  text: string;
  /** Offset of the block in the full text. */
  start: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Split Markdown into top-level blocks at blank lines (never inside a code
 * fence, never before an indented continuation), so finished blocks can be
 * memoised and only the growing tail is re-parsed on every frame.
 */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let fence: string | undefined;
  let start = 0;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker.charAt(0);
      else if (marker.charAt(0) === fence) fence = undefined;
    }
    offset += line.length + 1;
    const next = lines[i + 1];
    if (
      !fence &&
      line.trim() === '' &&
      next !== undefined &&
      next.trim() !== '' &&
      !/^\s/.test(next)
    ) {
      blocks.push({ text: text.slice(start, offset), start });
      start = offset;
    }
  }
  if (start < text.length) blocks.push({ text: text.slice(start), start });
  return blocks;
}

/**
 * Close Markdown that's still open mid-stream (a code fence, `**bold`, an
 * `inline code` span) so half-arrived syntax renders as what it will become
 * instead of flashing raw asterisks and backticks.
 */
export function closeOpenMarkdown(text: string): string {
  let fence: string | undefined;
  const prose: string[] = [];
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker && (!fence || marker.charAt(0) === fence.charAt(0))) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (!fence) prose.push(line);
  }
  if (fence) return `${text}\n${fence}`;
  const lastParagraph =
    prose
      .join('\n')
      .split(/\n\s*\n/)
      .at(-1) ?? '';
  const withoutCode = lastParagraph.replace(/`[^`]*`/g, '');
  if ((lastParagraph.match(/`/g)?.length ?? 0) % 2 === 1) return text.trimEnd() + '`';
  // What's still open, innermost first: an italic or a bold, then a strikethrough.
  const open: { mark: string; at: number }[] = [];
  const bold = [...withoutCode.matchAll(/\*\*/g)];
  if (bold.length % 2 === 1) open.push({ mark: '**', at: bold.at(-1)?.index ?? 0 });
  // A single `*` that opens an italic: not a list bullet, not "2 * 3".
  const italic = [
    ...withoutCode.replace(/\*\*/g, '  ').matchAll(/(?<=^|[^\s*])\*|\*(?=[^\s*])/gm),
  ].filter(
    (m) => !/^[ \t]*\*[ \t]/.test(withoutCode.slice(withoutCode.lastIndexOf('\n', m.index) + 1)),
  );
  if (italic.length % 2 === 1) open.push({ mark: '*', at: italic.at(-1)?.index ?? 0 });
  const strike = [...withoutCode.matchAll(/~~/g)];
  if (strike.length % 2 === 1) open.push({ mark: '~~', at: strike.at(-1)?.index ?? 0 });
  if (!open.length) return text;
  return (
    text.trimEnd() +
    open
      .sort((a, b) => b.at - a.at)
      .map((o) => o.mark)
      .join('')
  );
}

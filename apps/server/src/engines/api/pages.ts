/**
 * Stale pages go first (ADR 0055, ADR 0069).
 *
 * A browser task reads page after page, and every view of a page is in the
 * transcript. Once the chat needs room, the views the model has moved past are
 * the cheapest thing to let go: the page has changed since, and `browser_read`
 * shows it as it is now. So, before any turn is folded into the summary, every
 * page view older than the newest whole one becomes a one-line note of where
 * it was — the newest whole view and the changes after it stay, so the model
 * still knows the page it's on.
 *
 * Only tool results Conch wrote are touched, never the model's own messages;
 * and it happens only when the chat needs room, not on every step, so the
 * provider's prompt cache keeps its prefix in between.
 */
import {
  ADDRESS_LINE,
  CHANGES_CLOSE,
  CHANGES_OPEN,
  PAGE_CLOSE,
  PAGE_LINE,
  PAGE_OPEN,
} from '../../browser/marks';
import type { WireMessage } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Where a page view sits: a message, and the block in it (Anthropic's `tool_result`). */
interface View {
  message: number;
  block?: number;
  text: string;
  whole: boolean;
}

function kindOf(text: string): 'whole' | 'changes' | undefined {
  if (text.includes(PAGE_OPEN) && text.includes(PAGE_CLOSE)) return 'whole';
  if (text.includes(CHANGES_OPEN) && text.includes(CHANGES_CLOSE)) return 'changes';
  return undefined;
}

/** Every page view in tool results, oldest first, in any provider's shape. */
function views(messages: readonly WireMessage[]): View[] {
  const out: View[] = [];
  messages.forEach((message, i) => {
    const content = message.content;
    if (message.role === 'tool' && typeof content === 'string') {
      const kind = kindOf(content);
      if (kind) out.push({ message: i, text: content, whole: kind === 'whole' });
    } else if (message.role === 'user' && Array.isArray(content)) {
      content.forEach((block, b) => {
        if (!isRecord(block) || block.type !== 'tool_result' || typeof block.content !== 'string')
          return;
        const kind = kindOf(block.content);
        if (kind) out.push({ message: i, block: b, text: block.content, whole: kind === 'whole' });
      });
    }
  });
  return out;
}

/** The one line a stale view becomes: what came before the page, and where it was. */
export function staleNote(text: string): string {
  const start = text.indexOf(PAGE_LINE);
  const before = start > 0 ? text.slice(0, start).trim() : '';
  const lines = text.slice(Math.max(0, start)).split('\n');
  const title = lines
    .find((l) => l.startsWith(PAGE_LINE))
    ?.slice(PAGE_LINE.length)
    .trim();
  const address = lines
    .find((l) => l.startsWith(ADDRESS_LINE))
    ?.slice(ADDRESS_LINE.length)
    .trim();
  const where = [title && `“${title.slice(0, 120)}”`, address && `(${address.slice(0, 300)})`]
    .filter(Boolean)
    .join(' ');
  return [
    before,
    `[An earlier view of the page${where ? ` ${where}` : ''}, left out to save room: the page has changed since. browser_read shows it as it is now.]`,
  ]
    .filter(Boolean)
    .join('\n');
}

function rewrite(message: WireMessage, view: View, text: string): WireMessage {
  if (view.block === undefined) return { ...message, content: text };
  const content = (message.content as unknown[]).map((block, b) =>
    b === view.block && isRecord(block) ? { ...block, content: text } : block,
  );
  return { ...message, content };
}

/**
 * Every page view older than the newest whole one, as a short note. The
 * messages are new objects only where something changed; `collapsed` says how
 * many views went.
 */
export function collapseStalePages(messages: readonly WireMessage[]): {
  messages: WireMessage[];
  collapsed: number;
} {
  const found = views(messages);
  const newestWhole = found.findLastIndex((v) => v.whole);
  if (newestWhole <= 0) return { messages: [...messages], collapsed: 0 };
  const out = [...messages];
  let collapsed = 0;
  for (const view of found.slice(0, newestWhole)) {
    out[view.message] = rewrite(out[view.message] as WireMessage, view, staleNote(view.text));
    collapsed++;
  }
  return { messages: out, collapsed };
}

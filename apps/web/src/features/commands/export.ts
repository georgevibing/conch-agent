import type { ConversationView } from '../../live/reducer';

/**
 * `/export`: the chat as Markdown, as the person reads it — what was said,
 * where it was cleared, and its goal — never the model's hidden thinking.
 */
export function chatMarkdown(
  view: Pick<ConversationView, 'items' | 'goal'>,
  options: { title: string; name: string; at?: Date },
): string {
  const lines: string[] = [`# ${options.title.trim() || 'Chat'}`, ''];
  const at = options.at ?? new Date();
  lines.push(`_Saved from Conch on ${at.toLocaleString()}._`, '');
  if (view.goal) lines.push(`**Goal:** ${view.goal}`, '');
  let speaker: string | undefined;
  for (const item of view.items) {
    if (item.kind === 'user') {
      const attached = (item.attachments ?? []).map((a) => a.name);
      speaker = 'You';
      lines.push('## You', '', item.text.trim());
      if (attached.length) lines.push('', `_Attached: ${attached.join(', ')}_`);
      lines.push('');
    } else if (item.kind === 'assistant' && item.text.trim()) {
      // A reply that goes on after its tools is one reply, under one heading.
      if (speaker !== options.name || !item.continuation) lines.push(`## ${options.name}`, '');
      speaker = options.name;
      lines.push(item.text.trim(), '');
    } else if (item.kind === 'cleared') {
      speaker = undefined;
      lines.push('---', '', `_Context cleared: ${options.name} started fresh from here._`, '');
    } else if (item.kind === 'goal-note') {
      lines.push(item.goal ? `_Goal set: ${item.goal}_` : '_Goal cleared_', '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** A file name from the chat's title: "Plan my week" → "plan-my-week.md". */
export function exportName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'chat'}.md`;
}

/** Hand the browser a file to save. */
export function download(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The text of the latest reply, for `/copy`. */
export function lastReply(view: Pick<ConversationView, 'items'>): string | undefined {
  const items = view.items;
  const end = items.findLastIndex((i) => i.kind === 'assistant' && i.text.trim());
  if (end === -1) return undefined;
  const last = items[end];
  if (last?.kind !== 'assistant') return undefined;
  // Every segment of that reply, in order.
  const parts = items
    .filter((i) => i.kind === 'assistant' && i.messageId === last.messageId)
    .map((i) => (i.kind === 'assistant' ? i.text.trim() : ''));
  return parts.filter(Boolean).join('\n\n');
}

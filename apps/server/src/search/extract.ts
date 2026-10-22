import type { ConversationEvent, SearchRole } from '@conch/protocol';

import { questionLine } from '../questions/desk';

/** One searchable unit: a user message, an assistant reply, a tool call, or a question card. */
export interface SearchDoc {
  anchor: string;
  role: SearchRole;
  /** `seq` of the first and last event that contributed to it. */
  seq: number;
  lastSeq: number;
  at: number;
  text: string;
}

/**
 * Markdown → the text a reader sees, so snippets don't show `**` and `#` and
 * match what find-in-chat highlights in the rendered transcript.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^[ \t]*(```|~~~)[^\n]*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, '$1')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, '')
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
    .replace(/`+([^`\n]+?)`+/g, '$1')
    .trim();
}

const str = (input: Record<string, unknown>, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string) : undefined;

/** What a tool-call row shows: its name and the thing it acted on. */
export function toolText(name: string, raw: unknown): string {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const subject =
    str(input, 'command') ??
    str(input, 'file_path') ??
    str(input, 'path') ??
    str(input, 'notebook_path') ??
    str(input, 'pattern') ??
    str(input, 'url') ??
    str(input, 'query') ??
    str(input, 'description') ??
    '';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return `${mcp ? `${mcp[2]} (${mcp[1]})` : name} ${subject.slice(0, 2000)}`.trim();
}

/** Fold a conversation's event log into searchable documents, in order. */
export function extractDocs(events: ConversationEvent[]): SearchDoc[] {
  const docs: SearchDoc[] = [];
  // Assistant text arrives in deltas; collect the markdown, convert at the end.
  const assistant = new Map<string, SearchDoc>();
  const raw = new Map<SearchDoc, string>();
  /** A question card's document, by its id, for its answer to join. */
  const questions = new Map<string, SearchDoc>();
  for (const event of events) {
    switch (event.type) {
      case 'user.message':
        docs.push({
          anchor: event.messageId,
          role: 'user',
          seq: event.seq,
          lastSeq: event.seq,
          at: event.at,
          text: event.text,
        });
        break;
      case 'assistant.delta': {
        if (event.kind !== 'text') break;
        const doc = assistant.get(event.messageId);
        if (doc) {
          raw.set(doc, (raw.get(doc) ?? '') + event.delta);
          doc.lastSeq = event.seq;
        } else {
          const next: SearchDoc = {
            anchor: event.messageId,
            role: 'assistant',
            seq: event.seq,
            lastSeq: event.seq,
            at: event.at,
            text: '',
          };
          raw.set(next, event.delta);
          assistant.set(event.messageId, next);
          docs.push(next);
        }
        break;
      }
      case 'question': {
        // What the assistant asked on a card, and (below) what the person answered on it.
        const doc: SearchDoc = {
          anchor: event.question.questionId,
          role: 'assistant',
          seq: event.seq,
          lastSeq: event.seq,
          at: event.at,
          text: questionLine(event.question),
        };
        questions.set(doc.anchor, doc);
        docs.push(doc);
        break;
      }
      case 'question.answered': {
        const doc = questions.get(event.questionId);
        if (!doc || !event.answer) break;
        // The person's words: theirs, found as they'd find a message of theirs.
        doc.role = 'user';
        doc.lastSeq = event.seq;
        doc.text = `${doc.text}\n${event.answer.text}`;
        break;
      }
      case 'tool.started':
        if (event.name.startsWith('mcp__conch__')) break;
        docs.push({
          anchor: event.toolUseId,
          role: 'tool',
          seq: event.seq,
          lastSeq: event.seq,
          at: event.at,
          text: toolText(event.name, event.input),
        });
        break;
      default:
        break;
    }
  }
  for (const [doc, markdown] of raw) doc.text = plainText(markdown);
  return docs.filter((doc) => doc.text.trim().length > 0);
}

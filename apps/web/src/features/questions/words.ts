import type { Question } from '@conch/protocol';

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

/**
 * A question as it's said aloud (Talk, ADR 0027): its words, and the options
 * to choose from, so it can be answered by voice.
 */
export function questionWords(question: Pick<Question, 'title' | 'fields'>): string {
  const lines = question.fields.map((field) => {
    const asked = /[?.!]$/.test(field.label) ? field.label : `${field.label}?`;
    return field.kind === 'choice' ? `${asked} ${list(field.options.map((o) => o.label))}.` : asked;
  });
  const title = question.fields.length > 1 ? question.title?.trim() : undefined;
  return [title && (/[.?!:]$/.test(title) ? title : `${title}.`), ...lines]
    .filter(Boolean)
    .join(' ');
}

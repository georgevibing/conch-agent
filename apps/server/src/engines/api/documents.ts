/**
 * PDFs sent whole in a model API's transcript (ADR 0017).
 *
 * A PDF the person attached sits in the transcript in the provider's own shape:
 *
 *  - Anthropic: `{type:'document', source:{type:'base64', media_type:'application/pdf', data}, title}`;
 *  - every chat API that takes files (OpenAI, Gemini's OpenAI endpoint,
 *    OpenRouter): `{type:'file', file:{filename, file_data:'data:application/pdf;base64,…'}}`.
 *
 * This file counts them (a page costs far more than its bytes suggest, and
 * far less than base64 read as text), takes them out for a model that turned
 * out not to read them, lets old ones go so a long chat doesn't pay for them
 * on every request, and recognises a provider refusing one. No I/O.
 */
import type { WireMessage } from './types';

/** Roughly what one page costs a model: Anthropic's "1,500–3,000 tokens" of text, and its picture. */
export const PAGE_TOKENS = 2_500;

/**
 * A PDF stays whole for this many of the person's messages, its own
 * included; after that it's a line saying so (its text, sent beside it,
 * stays). Letting one go changes the transcript there, so the provider's
 * cache starts again from that point, once.
 */
export const KEEP_DOCUMENT_TURNS = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A PDF block in either shape, with its name and its base64. */
export function documentOf(block: unknown): { name: string; data: string } | undefined {
  if (!isRecord(block)) return undefined;
  if (
    block.type === 'document' &&
    isRecord(block.source) &&
    block.source.media_type === 'application/pdf' &&
    typeof block.source.data === 'string'
  )
    return {
      name: typeof block.title === 'string' ? block.title : 'a PDF',
      data: block.source.data,
    };
  if (block.type === 'file' && isRecord(block.file) && typeof block.file.file_data === 'string') {
    const match = /^data:application\/pdf;base64,/.exec(block.file.file_data);
    if (!match) return undefined;
    return {
      name: typeof block.file.filename === 'string' ? block.file.filename : 'a PDF',
      data: block.file.file_data.slice(match[0].length),
    };
  }
  return undefined;
}

/** Pages Conch already knows, by a print of the base64 (the engine says when it sends one). */
const known = new Map<string, number>();
const print = (data: string) => `${data.length}:${data.slice(0, 48)}:${data.slice(-48)}`;

/** Remember how many pages a PDF sent whole has, so counting it needn't open it. */
export function rememberPages(data: string, pages: number): void {
  if (known.size > 500) known.clear();
  known.set(print(data), pages);
}

/** How many pages a PDF has: as remembered, else its page objects counted, else by size. */
export function pagesOf(data: string): number {
  const key = print(data);
  const seen = known.get(key);
  if (seen !== undefined) return seen;
  const raw = Buffer.from(data, 'base64').toString('latin1');
  const counted = raw.match(/\/Type\s*\/Page(?![a-z])/g)?.length ?? 0;
  // Page objects packed into compressed streams can't be seen: about 60 KB a page then.
  const pages = Math.max(1, counted || Math.round(raw.length / 60_000));
  rememberPages(data, pages);
  return pages;
}

/** Tokens a PDF block costs, from its pages. */
export function documentTokens(block: unknown): number | undefined {
  const document = documentOf(block);
  return document ? pagesOf(document.data) * PAGE_TOKENS : undefined;
}

/** Whether a message carries a PDF sent whole. */
export function hasDocuments(message: WireMessage): boolean {
  return (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.some((block: unknown) => documentOf(block) !== undefined)
  );
}

/**
 * The same message with its PDFs put into words: `words` says what each
 * becomes. A message without one comes back as it was (the same object).
 */
export function wordsForDocuments(
  message: WireMessage,
  words: (name: string) => string,
): WireMessage {
  if (!hasDocuments(message) || !Array.isArray(message.content)) return message;
  const content = message.content.map((block: unknown) => {
    const document = documentOf(block);
    return document ? { type: 'text', text: words(document.name) } : block;
  });
  return { ...message, content };
}

/** What a PDF becomes once it's no longer sent whole. */
export const oldDocument = (name: string) =>
  `[The PDF "${name}" was shown here whole and is no longer. Its text, taken out by Conch, is with the message; read_document reads it again.]`;

/** What a PDF becomes for a model that turned out not to read PDFs. */
export const unreadDocument = (name: string) =>
  `[The PDF "${name}" can’t be read whole by this model. Its text, taken out by Conch, is with the message.]`;

/**
 * Only the PDFs of the newest `keep` messages from the person stay whole.
 * `isStart` says which user messages are the person's (not a tool's answers).
 */
export function ageDocuments(
  messages: readonly WireMessage[],
  isStart: (message: WireMessage) => boolean,
  keep = KEEP_DOCUMENT_TURNS,
): WireMessage[] {
  const out = [...messages];
  let turns = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i] as WireMessage;
    if (!isStart(message)) continue;
    turns++;
    if (turns > keep && hasDocuments(message)) out[i] = wordsForDocuments(message, oldDocument);
  }
  return out;
}

/**
 * Whether a refusal means "this model can't take a PDF (or a file part)", in
 * the words OpenAI, Gemini, OpenRouter and Anthropic use. Only ever asked
 * about a request that carried one.
 */
export function refusesDocuments(text: string): boolean {
  const words = text.toLowerCase();
  if (!/pdf|file|document/.test(words)) return false;
  return /not support|unsupported|does not|doesn['’]t|cannot|can['’]t|not (?:enabled|available|allowed|permitted)|invalid|unknown variant|unrecognized|expected|no endpoints/.test(
    words,
  );
}

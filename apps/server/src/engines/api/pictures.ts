/**
 * Pictures in a model API's transcript (ADR 0070).
 *
 * A screenshot a tool took, or a picture the person attached, sits in the
 * transcript in the provider's own shape:
 *
 *  - Anthropic: `{type:'image', source:{data}}` blocks, in a user message or
 *    inside a `tool_result`'s content;
 *  - every chat API (OpenAI's shape): `{type:'image_url'}` parts of a user
 *    message. A `tool` message only carries text there, so a tool's pictures
 *    ride in a user message straight after the results, which opens with
 *    `TOOL_PICTURES` so Conch knows it isn't the person speaking;
 *  - Ollama: `images` (bare base64) on a user message, the same way.
 *
 * This file finds them, takes them out (for a model that turned out not to
 * see, or once they're old) and recognises the refusal of a model that can't
 * look at pictures, in every provider's words. No I/O, so every rule is a test.
 */
import type { Picture } from '../types';
import type { WireMessage } from './types';

/**
 * How the message carrying a tool's pictures begins. Words, not a field: an
 * extra field is refused by some providers, and a version of Conch before this
 * one reads it as an ordinary message (ADR 0051).
 */
export const TOOL_PICTURES = '[Pictures from the tool results above';

/** The words in front of a tool's pictures, naming the tools they came from. */
export function toolPicturesLead(tools: readonly string[]): string {
  const names = [...new Set(tools)].join(', ');
  return `${TOOL_PICTURES}${names ? ` (${names})` : ''}. They belong to those results; this isn’t a message from the person.]`;
}

/** How many tool pictures stay in the transcript; older ones become a line of text. */
export const KEEP_TOOL_PICTURES = 3;

/** What an old screenshot becomes. */
export const OLD_PICTURE =
  '[An earlier picture from a tool, no longer shown. Take a new one if you need to look again.]';

/** What a picture becomes for a model that can't see, when nothing described it. */
export const UNSEEN_PICTURE = '[A picture was here, but this model can’t see pictures.]';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a user message only carries a tool's pictures (the middle of a turn, not the start of one). */
export function isToolPictures(message: WireMessage): boolean {
  if (message.role !== 'user') return false;
  const content = message.content;
  if (typeof content === 'string') return content.startsWith(TOOL_PICTURES);
  if (!Array.isArray(content)) return false;
  const first: unknown = content[0];
  return isRecord(first) && typeof first.text === 'string' && first.text.startsWith(TOOL_PICTURES);
}

/** A bare base64 picture's type, from its first bytes. */
function sniff(data: string): Picture['mimeType'] {
  if (data.startsWith('/9j/')) return 'image/jpeg';
  if (data.startsWith('R0lG')) return 'image/gif';
  if (data.startsWith('UklG')) return 'image/webp';
  return 'image/png';
}

/** A data URL's picture, or undefined for anything else (a link, which Conch never sends). */
function fromDataUrl(url: string): Picture | undefined {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url);
  if (!match) return undefined;
  return { mimeType: match[1] as Picture['mimeType'], data: match[2] as string };
}

/** The picture in one content block, in either block shape. */
function blockPicture(block: unknown): Picture | undefined {
  if (!isRecord(block)) return undefined;
  if (block.type === 'image' && isRecord(block.source) && typeof block.source.data === 'string') {
    const type = block.source.media_type;
    return {
      data: block.source.data,
      mimeType:
        typeof type === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(type)
          ? (type as Picture['mimeType'])
          : sniff(block.source.data),
    };
  }
  if (block.type === 'image_url') {
    const url = isRecord(block.image_url) ? block.image_url.url : block.image_url;
    return typeof url === 'string' ? fromDataUrl(url) : undefined;
  }
  return undefined;
}

/** Whether a message holds a picture, in any provider's shape. */
export function hasPictures(message: WireMessage): boolean {
  return picturesOf(message).length > 0;
}

/** Every picture in one message, in order: the person's, a tool's, Anthropic's nested ones. */
export function picturesOf(message: WireMessage): Picture[] {
  const out: Picture[] = [];
  if (Array.isArray(message.images))
    for (const data of message.images)
      if (typeof data === 'string') out.push({ data, mimeType: sniff(data) });
  const content = message.content;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    const own = blockPicture(block);
    if (own) out.push(own);
    else if (isRecord(block) && block.type === 'tool_result' && Array.isArray(block.content))
      for (const inner of block.content) {
        const nested = blockPicture(inner);
        if (nested) out.push(nested);
      }
  }
  return out;
}

/**
 * The same message with its pictures put into words: `words` says what each
 * becomes. `tools`: only the pictures tools returned, never the person's own.
 * A message without pictures comes back as it was (the same object).
 */
export function wordsForPictures(
  message: WireMessage,
  words: (picture: Picture) => string,
  options: { tools?: boolean } = {},
): WireMessage {
  if (message.role !== 'user') return message;
  const toolMessage = isToolPictures(message);
  const ours = !options.tools || toolMessage;
  let changed = false;
  let next: WireMessage = message;
  if (ours && Array.isArray(message.images) && message.images.length) {
    const said = message.images
      .filter((d): d is string => typeof d === 'string')
      .map((data) => words({ data, mimeType: sniff(data) }));
    const { images: _images, ...rest } = message;
    const content = typeof message.content === 'string' ? message.content : '';
    next = { ...rest, content: [content, ...said].filter(Boolean).join('\n\n') };
    changed = true;
  }
  const content = next.content;
  if (Array.isArray(content)) {
    const blocks = content.map((block: unknown) => {
      const own = ours ? blockPicture(block) : undefined;
      if (own) {
        changed = true;
        return { type: 'text', text: words(own) };
      }
      if (isRecord(block) && block.type === 'tool_result' && Array.isArray(block.content)) {
        let inner = false;
        const nested = block.content.map((item: unknown) => {
          const picture = blockPicture(item);
          if (!picture) return item;
          inner = true;
          return { type: 'text', text: words(picture) };
        });
        if (inner) {
          changed = true;
          return { ...block, content: nested };
        }
      }
      return block;
    });
    if (changed) next = { ...next, content: blocks };
  }
  return changed ? next : message;
}

/**
 * Only the newest few tool pictures stay as pictures: every picture is sent,
 * and paid for, on every request after it. The older ones become a line that
 * says so. The person's own pictures always stay.
 */
export function ageToolPictures(
  messages: readonly WireMessage[],
  keep = KEEP_TOOL_PICTURES,
): WireMessage[] {
  let seen = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i] as WireMessage;
    const count = toolPictureCount(message);
    if (!count) continue;
    if (seen >= keep) out[i] = wordsForPictures(message, () => OLD_PICTURE, { tools: true });
    seen += count;
  }
  return out;
}

/** How many of a message's pictures came from tools. */
export function toolPictureCount(message: WireMessage): number {
  if (message.role !== 'user') return 0;
  if (isToolPictures(message)) return picturesOf(message).length;
  const content = message.content;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content)
    if (isRecord(block) && block.type === 'tool_result' && Array.isArray(block.content))
      for (const inner of block.content) if (blockPicture(inner)) n++;
  return n;
}

/**
 * Whether a refusal means "this model can't look at pictures", in the words
 * OpenAI, OpenRouter, Anthropic, Google, Mistral, DeepSeek, Groq, xAI, vLLM,
 * llama.cpp, LM Studio and Ollama use. Only ever asked about a request that
 * carried pictures.
 */
export function refusesImages(text: string): boolean {
  const words = text.toLowerCase();
  if (/no endpoints found that support image/.test(words)) return true;
  if (
    /unknown variant .?image_url|image_url.{0,40}(?:unknown|not (?:allowed|permitted|supported))/.test(
      words,
    )
  )
    return true;
  if (
    /missing data required for image|image input|vision|multi-?modal|modalit|image_url|images?\b|picture/.test(
      words,
    )
  )
    return /not support|unsupported|does not|doesn['’]t|cannot|can['’]t|not (?:enabled|available|allowed|permitted|a vision|capable)|no endpoints|only (?:supports? )?text|text[- ]only|missing data|invalid content type|unknown variant|expected `?text/.test(
      words,
    );
  // A server whose messages only take a string can't take a picture either.
  return /content must be a string|content.{0,20}expected.{0,20}string/.test(words);
}

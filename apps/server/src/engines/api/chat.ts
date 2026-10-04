/**
 * The chat API most providers speak: OpenAI's `POST …/chat/completions`.
 *
 * OpenRouter, OpenAI, Gemini's compatibility endpoint, xAI, DeepSeek, Mistral,
 * Groq, Cerebras, Z.ai, Kimi, MiniMax, Qwen and any server you run yourself all
 * stream the same frames with small differences in the edges. This file is the
 * shared middle: reading one streamed turn into Conch's `WireEvent`s, and the
 * shapes of the user message, tool results and tool list. The edges — where the
 * thinking text arrives, what has to be sent back, how effort is asked for —
 * are a `ChatDialect`, so each provider only says how it differs.
 *
 * Details that are easy to get wrong, and why the reader is tolerant:
 *  - usage arrives on its own frame (`choices: []`) after `include_usage`, on the
 *    last content frame, or under `x_groq`; the last one seen wins, so a frame
 *    that repeats `finish_reason` with a usage block is never a second ending;
 *  - thinking text is `reasoning_content` (DeepSeek, Qwen, Kimi, Z.ai, xAI),
 *    `reasoning` (OpenRouter, Groq, Cerebras) or a `thinking` part inside an
 *    array `content` (Mistral's Magistral);
 *  - a failure after the 200 arrives as an ordinary frame with a top-level `error`;
 *  - streamed tool calls only promise `index`: the name and id come once, the
 *    arguments arrive as JSON fragments. A server that leaves out `index` is keyed
 *    by id, and one that sends arguments as an object is stringified;
 *  - `extra_content` on a tool call (Gemini's thought signature) must go back
 *    exactly as it came, or the next request is refused.
 */
import { z } from 'zod';

import type { Picture } from '../types';
import { toolPicturesLead } from './pictures';
import { sseEvents } from './sse';
import type {
  ApiError,
  ToolSpec,
  WireEvent,
  WireMessage,
  WireStop,
  WireToolCall,
  WireUsage,
} from './types';
import { frame, type ToolResult } from './wire';

/** A provider's error object, as it arrives in a frame or an error body. */
export const ChatError = z.object({
  code: z.union([z.number(), z.string()]).nullish(),
  message: z.string().nullish(),
  type: z.string().nullish(),
  status: z.union([z.number(), z.string()]).nullish(),
  metadata: z
    .object({ error_type: z.string().nullish(), limit_source: z.string().nullish() })
    .nullish(),
});
export type ChatError = z.infer<typeof ChatError>;

const Usage = z.object({
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  /** How much of the prompt came from the provider's cache, when it says. */
  prompt_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
  /** OpenRouter's credits, which are USD — the real charge for the request. */
  cost: z.number().nullish(),
});

const ToolCallDelta = z.object({
  index: z.number().nullish(),
  id: z.string().nullish(),
  type: z.string().nullish(),
  function: z
    .object({
      name: z.string().nullish(),
      arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
    })
    .nullish(),
  /** Gemini's thought signature lives here; it goes back exactly as it came. */
  extra_content: z.record(z.string(), z.unknown()).nullish(),
});

const Part = z.object({
  type: z.string().nullish(),
  text: z.string().nullish(),
  thinking: z.union([z.string(), z.array(z.object({ text: z.string().nullish() }))]).nullish(),
});

const Chunk = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.union([z.string(), z.array(Part)]).nullish(),
            reasoning_content: z.string().nullish(),
            reasoning: z.string().nullish(),
            /** Typed reasoning blocks with signatures (OpenRouter), for replaying. */
            reasoning_details: z.array(z.unknown()).nullish(),
            tool_calls: z.array(ToolCallDelta).nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: Usage.nullish(),
  x_groq: z.object({ usage: Usage.nullish() }).nullish(),
  error: ChatError.nullish(),
});

/** A non-streamed answer, for one short completion. */
export const ChatCompletion = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.union([z.string(), z.array(Part)]).nullish(),
          })
          .nullish(),
      }),
    )
    .nullish(),
  usage: Usage.nullish(),
  error: ChatError.nullish(),
});

/** How one provider differs from the shape everyone shares. */
export interface ChatDialect {
  /** The provider's name, for the sentences a person reads. */
  label: string;
  /** A failure that arrived inside a 200 (a frame, or a body with only an error). */
  fail(error: ChatError): ApiError;
  /**
   * Put the thinking text back on the assistant message, under this field, so
   * the next request in a tool loop carries it (DeepSeek and Kimi refuse one
   * that doesn't while thinking is on).
   */
  replayReasoning?: 'reasoning_content';
  /**
   * The model may think out loud inside `<think>…</think>` in its answer
   * (MiniMax by default, open models on your own server): shown as thinking,
   * kept in the message exactly as sent, because the provider wants it back.
   */
  thinkTags?: boolean;
}

const OPEN = '<think>';
const CLOSE = '</think>';

/** How much of the end of `text` could be the start of `tag`, so it waits for the next piece. */
function partial(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--)
    if (tag.startsWith(text.slice(-n))) return n;
  return 0;
}

/**
 * Splits streamed text into what's said and what's thought, by `<think>` tags
 * that may arrive cut in half (`<thi` then `nk>`).
 */
export class ThinkSplitter {
  #held = '';
  #thinking = false;

  push(delta: string): { text: string; thinking: string } {
    let rest = this.#held + delta;
    this.#held = '';
    let text = '';
    let thinking = '';
    while (rest) {
      const tag = this.#thinking ? CLOSE : OPEN;
      const at = rest.indexOf(tag);
      if (at >= 0) {
        if (this.#thinking) thinking += rest.slice(0, at);
        else text += rest.slice(0, at);
        rest = rest.slice(at + tag.length);
        this.#thinking = !this.#thinking;
        continue;
      }
      const wait = partial(rest, tag);
      const now = rest.slice(0, rest.length - wait);
      if (this.#thinking) thinking += now;
      else text += now;
      this.#held = rest.slice(rest.length - wait);
      rest = '';
    }
    return { text, thinking };
  }

  /** Whatever was held back waiting for a tag that never came. */
  flush(): { text: string; thinking: string } {
    const held = this.#held;
    this.#held = '';
    return this.#thinking ? { text: '', thinking: held } : { text: held, thinking: '' };
  }
}

/** Usage numbers, never negative, with the cost only when the provider priced it. */
export function usageFrom(usage: z.infer<typeof Usage>): WireUsage {
  return {
    inputTokens: Math.max(0, Math.round(usage.prompt_tokens ?? 0)),
    outputTokens: Math.max(0, Math.round(usage.completion_tokens ?? 0)),
    ...(usage.prompt_tokens_details?.cached_tokens && {
      cachedInputTokens: Math.max(0, Math.round(usage.prompt_tokens_details.cached_tokens)),
    }),
    ...(typeof usage.cost === 'number' && { costUsd: Math.max(0, usage.cost) }),
  };
}

/** The visible text and the thinking in a `content` that may be a string or parts. */
function contentParts(content: string | z.infer<typeof Part>[] | null | undefined): {
  text: string;
  thinking: string;
} {
  if (!content) return { text: '', thinking: '' };
  if (typeof content === 'string') return { text: content, thinking: '' };
  let text = '';
  let thinking = '';
  for (const part of content) {
    if (part.type === 'thinking') {
      const value = part.thinking;
      thinking +=
        typeof value === 'string' ? value : (value ?? []).map((t) => t.text ?? '').join('');
    } else if (typeof part.text === 'string') text += part.text;
  }
  return { text, thinking };
}

/** The text of a non-streamed answer. */
export function completionText(body: z.infer<typeof ChatCompletion>): string {
  return contentParts(body.choices?.[0]?.message?.content).text;
}

/**
 * One streamed turn, read into Conch's events. Ends with exactly one `end`
 * carrying the assistant message to append — rebuilt so that everything a
 * provider needs back (reasoning blocks, thought signatures) survives a replay.
 */
export async function* readChatStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  dialect: ChatDialect,
): AsyncGenerator<WireEvent> {
  let content = '';
  let thinking = '';
  const details: unknown[] = [];
  const calls = new Map<
    string,
    { order: number; id?: string; name?: string; args: string; extra?: Record<string, unknown> }
  >();
  let usage: WireUsage | undefined;
  let finish: string | undefined;
  const tags = dialect.thinkTags ? new ThinkSplitter() : undefined;

  for await (const event of sseEvents(body, signal)) {
    if (event.data === '[DONE]') break;
    const chunk = frame(Chunk, event.data);
    if (!chunk) continue;
    if (chunk.error) throw dialect.fail(chunk.error);
    const counted = chunk.usage ?? chunk.x_groq?.usage;
    if (counted) usage = usageFrom(counted);
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    const parts = contentParts(delta?.content);
    // The raw words go back to the provider as they came, tags and all.
    content += parts.text;
    const split = tags && parts.text ? tags.push(parts.text) : { text: parts.text, thinking: '' };
    const thought =
      (delta?.reasoning_content ?? delta?.reasoning ?? '') + parts.thinking + split.thinking;
    if (thought) {
      thinking += thought;
      yield { type: 'thinking', delta: thought };
    }
    if (delta?.reasoning_details?.length) details.push(...delta.reasoning_details);
    if (split.text) yield { type: 'text', delta: split.text };
    for (const call of delta?.tool_calls ?? []) {
      // `index` is the promise; a server without it is keyed by id, then by arrival.
      const key =
        typeof call.index === 'number'
          ? `i${call.index}`
          : call.id
            ? `id:${call.id}`
            : `n${calls.size}`;
      const existing = calls.get(key) ?? { order: calls.size, args: '' };
      const piece = call.function?.arguments;
      calls.set(key, {
        order: existing.order,
        id: call.id ?? existing.id,
        name: call.function?.name ?? existing.name,
        args:
          existing.args + (typeof piece === 'string' ? piece : piece ? JSON.stringify(piece) : ''),
        extra: call.extra_content ?? existing.extra,
      });
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  const rest = tags?.flush();
  if (rest?.thinking) yield { type: 'thinking', delta: rest.thinking };
  if (rest?.text) yield { type: 'text', delta: rest.text };

  const ordered = [...calls.values()].sort((a, b) => a.order - b.order).filter((c) => c.name);
  const toolCalls: WireToolCall[] = ordered.map((call, index) => ({
    // An id always arrives in practice; one made from the position keeps the
    // round trip valid if it ever doesn't.
    id: call.id ?? `call_${index}`,
    name: call.name ?? '',
    argumentsJson: call.args,
  }));
  const stop: WireStop = toolCalls.length ? 'tools' : finish === 'length' ? 'length' : 'end';
  const message: WireMessage = {
    role: 'assistant',
    content: content.length ? content : null,
    ...(dialect.replayReasoning && thinking && { [dialect.replayReasoning]: thinking }),
    ...(details.length && { reasoning_details: details }),
    ...(toolCalls.length && {
      tool_calls: toolCalls.map((call, index) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.argumentsJson },
        ...(ordered[index]?.extra && { extra_content: ordered[index].extra }),
      })),
    }),
  };
  yield { type: 'end', message, toolCalls, stop, ...(usage && { usage }) };
}

/** A picture as a chat API takes it: a data URL in an `image_url` part. */
function imagePart(image: Picture): Record<string, unknown> {
  return { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } };
}

/** The user's words, with any pictures first, as every chat API takes them. */
export function chatUserMessage(content: string, images?: readonly Picture[]): WireMessage {
  if (!images?.length) return { role: 'user', content };
  return {
    role: 'user',
    content: [...images.map(imagePart), { type: 'text', text: content }],
  };
}

/**
 * Tool answers, one `tool` message each. A `tool` message only carries text
 * in the chat APIs (OpenAI refuses a picture there), so the pictures the tools
 * returned follow in one user message that says whose they are (ADR 0070).
 */
export function chatToolResults(results: ToolResult[]): WireMessage[] {
  const messages: WireMessage[] = results.map((result) => ({
    role: 'tool',
    tool_call_id: result.id,
    content: result.text,
  }));
  const pictured = results.filter((result) => result.images?.length);
  if (pictured.length)
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: toolPicturesLead(pictured.map((result) => result.name)) },
        ...pictured.flatMap((result) => (result.images ?? []).map(imagePart)),
      ],
    });
  return messages;
}

/**
 * A provider that refuses a user message straight after a tool's (Mistral:
 * "Unexpected role 'user' after role 'tool'") gets a blank assistant turn
 * between them, only in the request: the transcript keeps what happened.
 */
export function bridgeToolToUser(messages: readonly WireMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user' && out.at(-1)?.role === 'tool')
      out.push({ role: 'assistant', content: ' ' });
    out.push(message);
  }
  return out;
}

/** The tool list, as `tools` takes it. Empty means none is sent at all. */
export function chatTools(tools: readonly ToolSpec[]): Record<string, unknown> {
  if (!tools.length) return {};
  return {
    tools: tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.schema },
    })),
    tool_choice: 'auto',
  };
}

/** Parse a body that may not be JSON, for error envelopes. */
export function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * The error object in an error body, in any of the shapes providers use:
 * `{error: {…}}` (OpenAI and most), `[{error: {…}}]` (Gemini's POSTs),
 * `{code, error: "…"}` (xAI), `{error: "…"}` (Hugging Face, Venice), fields at
 * the top level (Cerebras), `{detail: "…"}` (Mistral) or problem+json
 * `{title, status, detail}` (NVIDIA). Read whatever the content type says.
 */
export function errorIn(body: string): ChatError | undefined {
  const raw = safeJson(body);
  if (!raw || typeof raw !== 'object') return undefined;
  const top = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!top || typeof top !== 'object') return undefined;
  const inner = 'error' in top ? top.error : top;
  if (typeof inner === 'string')
    return {
      message: inner,
      ...((typeof top.code === 'string' || typeof top.code === 'number') && { code: top.code }),
    };
  if (!inner || typeof inner !== 'object') return undefined;
  const parsed = ChatError.safeParse(inner);
  const error = parsed.success ? parsed.data : {};
  const fields = inner as Record<string, unknown>;
  const detail = typeof fields.detail === 'string' ? fields.detail : undefined;
  const title = typeof fields.title === 'string' ? fields.title : undefined;
  return { ...error, message: error.message ?? detail ?? title ?? undefined };
}

/** A short, stable reading of an error object's kind, whatever field it sits in. */
export function errorKind(error: ChatError | undefined): string {
  return [error?.metadata?.error_type, error?.type, error?.code, error?.status]
    .filter((v) => v !== undefined && v !== null)
    .map(String)
    .join(' ')
    .toLowerCase();
}

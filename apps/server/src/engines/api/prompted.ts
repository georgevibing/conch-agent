/**
 * Tools through the prompt, for models that can't take them natively (ADR 0072).
 *
 * A small local model, a chat-only model at OpenRouter, a server that refuses
 * `tools`: each can still use Conch's tools if it's told what they are and how
 * to ask, in words. The tools are listed in the system prompt in one short line
 * each, and the model asks for one in the format Hermes and Qwen models are
 * trained on (and Llama, Gemma and Mistral follow when asked):
 *
 *     <tool_call>
 *     {"name": "remember", "arguments": {"content": "Likes tea"}}
 *     </tool_call>
 *
 * The reader takes that and the shapes small models drift into: the same JSON
 * in a ```tool_call or ```json fence, Llama's `<function=name>{…}</function>`,
 * Qwen-Coder's `<parameter=key>` lines, a reply that is nothing but the call's
 * JSON, `"parameters"` for `"arguments"`, almost-JSON (`repair.ts`). It reads
 * the stream as it comes: words are shown at once, a call is held back until
 * it closes, and a `<tool_response>` the model writes itself (pretending a
 * tool answered) is never shown or believed. Results go back as the next user
 * message, in `<tool_response>` blocks.
 */
import { repairJson } from '../tools/repair';
import { signature } from '../tools/args';
import type { ToolSpec, WireMessage, WireToolCall } from './types';
import type { ToolResult } from './wire';

/** The name given to a call block nobody could read, so the model hears how to write one. */
export const UNREADABLE = 'unreadable_tool_call';

/** What the model hears about a call block nobody could read. */
export const UNREADABLE_MESSAGE =
  'Conch couldn’t read that tool call. Write it as <tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>, with one JSON object inside.';

/** How much of a tool's description each listing keeps. */
export type CatalogueLevel = 'full' | 'compact' | 'tiny';

const DESCRIPTION: Record<CatalogueLevel, number> = { full: 400, compact: 120, tiny: 0 };

/** The first sentence of a description, clipped. */
function summary(text: string, max: number): string {
  if (!max) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const first = max < 200 ? (/^(.+?[.!?])(\s|$)/.exec(clean)?.[1] ?? clean) : clean;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** A tool, in one line: `name({query: string, limit?: integer}) — Finds mail.` */
function line(spec: ToolSpec, level: CatalogueLevel): string {
  const about = summary(spec.description, DESCRIPTION[level]);
  return `- ${spec.name}(${signature(spec.schema)})${about ? ` — ${about}` : ''}`;
}

/** An example call with the first tool's first required argument, so the shape is unmistakable. */
function example(specs: readonly ToolSpec[]): string {
  const first = specs[0];
  const required = Array.isArray(first?.schema['required']) ? first.schema['required'] : [];
  const key = typeof required[0] === 'string' ? required[0] : undefined;
  return JSON.stringify({ name: first?.name ?? 'tool_name', arguments: key ? { [key]: '…' } : {} });
}

/** The tools and how to call them, for the end of the system prompt. */
export function catalogue(specs: readonly ToolSpec[], level: CatalogueLevel): string {
  return [
    '# Tools',
    'You can use the tools listed below. To use one, write a tool call block like this, then stop:',
    '<tool_call>',
    example(specs),
    '</tool_call>',
    '- Put exactly one JSON object in each block, with "name" and "arguments". To use several tools, write several blocks.',
    '- After your tool calls, stop writing. The results come back in the next message, inside <tool_response> blocks.',
    '- Never write a <tool_response> yourself, and never say a tool did something before you have its response.',
    '- When no tool is needed, just answer.',
    '',
    `Tools (arguments marked ? are optional):`,
    ...specs.map((spec) => line(spec, level)),
  ].join('\n');
}

/** Tool answers, as the user message that follows the model's calls. */
export function promptedResults(results: readonly ToolResult[]): string {
  return results
    .map((result) => {
      // A tool's text is data: it can't close its own block and open a forged one.
      const text = result.text.replace(/<\/?tool_response/gi, (tag) => tag.replace('<', '<\\'));
      return `<tool_response name="${result.name}"${result.isError ? ' status="error"' : ''}>\n${text}\n</tool_response>`;
    })
    .join('\n');
}

/**
 * A transcript as a model without native tools can read it: earlier native
 * calls (an OpenAI-style `tool_calls`, a `tool` message) written as the same
 * blocks it's asked to write. Only what's sent changes; the transcript is kept
 * as it was, so a model that takes tools natively later reads it natively.
 */
export function promptedHistory(messages: readonly WireMessage[]): WireMessage[] {
  if (!messages.some((m) => m['role'] === 'tool' || Array.isArray(m['tool_calls'])))
    return [...messages];
  const names = new Map<string, string>();
  const out: WireMessage[] = [];
  let answers: ToolResult[] = [];
  const flush = () => {
    if (answers.length) out.push({ role: 'user', content: promptedResults(answers) });
    answers = [];
  };
  for (const message of messages) {
    if (message['role'] === 'tool') {
      const id = typeof message['tool_call_id'] === 'string' ? message['tool_call_id'] : '';
      const named = typeof message['tool_name'] === 'string' ? message['tool_name'] : undefined;
      const content = message['content'];
      answers.push({
        id,
        name: named ?? names.get(id) ?? 'tool',
        text: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
        isError: false,
      });
      continue;
    }
    flush();
    const calls = message['tool_calls'];
    if (message['role'] !== 'assistant' || !Array.isArray(calls)) {
      out.push(message);
      continue;
    }
    const blocks: string[] = [];
    for (const call of calls) {
      const fn = isRecord(call) && isRecord(call['function']) ? call['function'] : undefined;
      const name = typeof fn?.['name'] === 'string' ? fn['name'] : undefined;
      if (!name) continue;
      if (isRecord(call) && typeof call['id'] === 'string') names.set(call['id'], name);
      const args = fn?.['arguments'];
      const parsed = typeof args === 'string' ? (repairJson(args)?.value ?? {}) : (args ?? {});
      blocks.push(`<tool_call>\n${JSON.stringify({ name, arguments: parsed })}\n</tool_call>`);
    }
    const { tool_calls: _calls, ...rest } = message;
    const said = typeof message['content'] === 'string' ? message['content'] : '';
    out.push({ ...rest, content: [said, ...blocks].filter(Boolean).join('\n') });
  }
  flush();
  return out;
}

/** Whether a user message is tool answers rather than the person speaking. */
export function isPromptedResults(content: unknown): boolean {
  return typeof content === 'string' && content.startsWith('<tool_response name="');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ARG_KEYS = ['arguments', 'parameters', 'args', 'input', 'params'];
const NAME_KEYS = ['name', 'tool', 'tool_name', 'function', 'action'];

/** The calls in one value: `{"name", "arguments"}`, OpenAI's `{"function": {…}}`, or a list of them. */
function callsIn(value: unknown, depth = 0): { name: string; args: unknown }[] {
  if (depth > 2) return [];
  if (Array.isArray(value)) return value.flatMap((v) => callsIn(v, depth + 1));
  if (!isRecord(value)) return [];
  if (isRecord(value['function']) && typeof value['function']['name'] === 'string')
    return [{ name: value['function']['name'], args: value['function']['arguments'] ?? {} }];
  if (Array.isArray(value['tool_calls'])) return callsIn(value['tool_calls'], depth + 1);
  const nameKey = NAME_KEYS.find((k) => typeof value[k] === 'string');
  if (!nameKey) return [];
  const argKey = ARG_KEYS.find((k) => k in value);
  const args = argKey
    ? value[argKey]
    : Object.fromEntries(Object.entries(value).filter(([k]) => k !== nameKey));
  return [{ name: value[nameKey] as string, args }];
}

/** `<function=name>` with a JSON body or `<parameter=key>value</parameter>` lines. */
function functionCall(text: string): { name: string; args: unknown } | undefined {
  const head = /<function=([^>\s]+)>/.exec(text);
  if (!head?.[1]) return undefined;
  const body = text
    .slice((head.index ?? 0) + head[0].length)
    .replace(/<\/function>[\s\S]*$/, '')
    .trim();
  const params = [
    ...body.matchAll(/<parameter=([^>\s]+)>\s*([\s\S]*?)\s*(?:<\/parameter>|(?=<parameter=)|$)/g),
  ];
  if (params.length)
    return { name: head[1], args: Object.fromEntries(params.map((m) => [m[1] ?? '', m[2] ?? ''])) };
  return { name: head[1], args: body ? (repairJson(body)?.value ?? {}) : {} };
}

/** The calls in one block's text. */
function parseBlock(text: string): { name: string; args: unknown }[] {
  const body = text.trim();
  if (body.includes('<function=')) {
    const call = functionCall(body);
    return call ? [call] : [];
  }
  const read = repairJson(body);
  if (!read) return [];
  return [read.value, ...read.rest].flatMap((v) => callsIn(v));
}

/** Text that may be the start of a marker, held back until the next piece says. */
const MARKERS = ['<tool_call>', '<tool_call ', '<function=', '```', '<tool_response'];

function heldBack(text: string): number {
  let longest = 0;
  for (const marker of MARKERS)
    for (let n = Math.min(marker.length - 1, text.length); n > longest; n--)
      if (marker.startsWith(text.slice(-n))) {
        longest = n;
        break;
      }
  return longest;
}

/** Fence languages a call may arrive in; any other fence is code to show. */
const CALL_FENCES = new Set(['', 'tool_call', 'tool', 'tool_code', 'function', 'json', 'json5']);

type State =
  | { kind: 'text' }
  | { kind: 'tag'; close: string }
  | { kind: 'fence'; lang?: string; body: number }
  | { kind: 'code' }
  | { kind: 'lead' }
  | { kind: 'dropped' };

/**
 * Reads one streamed reply for tool calls. `push` returns the words to show
 * now; `finish` returns the rest, the calls, and the reply as it should be
 * kept in the transcript (words and canonical calls, nothing invented).
 */
export class PromptedReader {
  #raw = '';
  #pos = 0;
  #state: State = { kind: 'text' };
  #shown = '';
  #calls: { name: string; args: unknown }[] = [];
  /** Whether the model wrote a tool's answer itself. */
  invented = false;

  /** `resolve` maps a name the model wrote to a tool's name, or undefined for none. */
  constructor(private readonly resolve: (name: string) => string | undefined) {}

  push(delta: string): string {
    this.#raw += delta;
    return this.#step(false);
  }

  finish(): { text: string; calls: WireToolCall[]; content: string } {
    const text = this.#step(true);
    const calls = this.#calls.map((call, i) => ({
      id: `call_prompted_${i + 1}`,
      name: call.name,
      argumentsJson: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {}),
    }));
    const blocks = calls.map(
      (call) =>
        `<tool_call>\n${JSON.stringify({ name: call.name, arguments: safeJson(call.argumentsJson) })}\n</tool_call>`,
    );
    return {
      text,
      calls,
      content: [this.#shown.trim(), ...blocks].filter(Boolean).join('\n'),
    };
  }

  #emit(text: string): string {
    this.#shown += text;
    return text;
  }

  /** Calls from a block: a tag's always count (an unknown name is told so); a fence's only when they name a tool. */
  #take(block: string, strict: boolean): boolean {
    const found = parseBlock(block);
    const known = found.map((c) => ({ ...c, name: this.resolve(c.name) ?? c.name }));
    if (!found.length || (strict && !found.every((c) => this.resolve(c.name)))) return false;
    this.#calls.push(...known);
    return true;
  }

  #step(end: boolean): string {
    let out = '';
    const raw = this.#raw;
    for (;;) {
      const state = this.#state;
      if (state.kind === 'dropped') {
        this.#pos = raw.length;
        return out;
      }
      if (state.kind === 'lead') {
        if (!end) return out;
        const rest = raw.slice(this.#pos);
        this.#pos = raw.length;
        if (!this.#take(rest, true)) out += this.#emit(rest);
        return out;
      }
      if (state.kind === 'tag') {
        const close = raw.indexOf(state.close, this.#pos);
        if (close === -1 && !end) return out;
        const stop = close === -1 ? raw.length : close + state.close.length;
        const block = raw.slice(this.#pos, stop);
        this.#pos = stop;
        this.#state = { kind: 'text' };
        const inner = block.startsWith('<tool_call')
          ? block.replace(/^<tool_call[^>]*>/, '').replace(/<\/tool_call>$/, '')
          : block;
        // A block that can't be read is still a call: the model is told how to write one.
        if (!this.#take(inner, false)) this.#calls.push({ name: UNREADABLE, args: {} });
        continue;
      }
      if (state.kind === 'fence') {
        if (state.lang === undefined) {
          const eol = raw.indexOf('\n', this.#pos);
          if (eol === -1 && !end) return out;
          const lang = raw
            .slice(this.#pos + 3, eol === -1 ? raw.length : eol)
            .trim()
            .toLowerCase();
          if (!CALL_FENCES.has(lang)) {
            // Code to show: its words go out as they come, markers inside it are just text.
            this.#state = { kind: 'code' };
            const head = raw.slice(this.#pos, eol === -1 ? raw.length : eol + 1);
            this.#pos += head.length;
            out += this.#emit(head);
            continue;
          }
          this.#state = { kind: 'fence', lang, body: eol === -1 ? raw.length : eol + 1 };
          continue;
        }
        const close = raw.indexOf('```', state.body);
        if (close === -1 && !end) return out;
        const stop = close === -1 ? raw.length : close + 3;
        const block = raw.slice(this.#pos, stop);
        const inner = raw.slice(state.body, close === -1 ? raw.length : close);
        this.#pos = stop;
        this.#state = { kind: 'text' };
        if (!this.#take(inner, true)) out += this.#emit(block);
        continue;
      }
      if (state.kind === 'code') {
        const close = raw.indexOf('```', this.#pos);
        if (close === -1) {
          const keep = end ? 0 : Math.min(2, raw.length - this.#pos);
          out += this.#emit(raw.slice(this.#pos, raw.length - keep));
          this.#pos = raw.length - keep;
          return out;
        }
        out += this.#emit(raw.slice(this.#pos, close + 3));
        this.#pos = close + 3;
        this.#state = { kind: 'text' };
        continue;
      }
      // Plain words: up to the next thing that may be a call.
      const rest = raw.slice(this.#pos);
      if (!this.#shown.trim() && !this.#calls.length && /^\s*[{[]/.test(rest)) {
        // A reply that starts as JSON may be nothing but a call: wait for all of it.
        this.#state = { kind: 'lead' };
        continue;
      }
      const at = earliest(rest);
      if (!at) {
        if (!this.#shown.trim() && !end && !rest.trim()) return out;
        const keep = end ? 0 : heldBack(rest);
        out += this.#emit(rest.slice(0, rest.length - keep));
        this.#pos += rest.length - keep;
        return out;
      }
      out += this.#emit(rest.slice(0, at.index));
      this.#pos += at.index;
      if (at.marker === '<tool_response') {
        this.invented = true;
        this.#state = { kind: 'dropped' };
      } else if (at.marker === '```') this.#state = { kind: 'fence', body: 0 };
      else
        this.#state = {
          kind: 'tag',
          close: at.marker === '<function=' ? '</function>' : '</tool_call>',
        };
    }
  }
}

function earliest(text: string): { index: number; marker: string } | undefined {
  let best: { index: number; marker: string } | undefined;
  for (const marker of MARKERS) {
    const index = text.indexOf(marker);
    if (index !== -1 && (!best || index < best.index)) best = { index, marker };
  }
  return best && { ...best, marker: best.marker === '<tool_call ' ? '<tool_call>' : best.marker };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

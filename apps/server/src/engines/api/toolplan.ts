/**
 * How one turn hands its tools to the model (ADR 0072).
 *
 * Three ways, tried in order and remembered per model, so every model gets
 * the most it can take:
 *
 *  1. **Native**: the provider's own `tools`, each schema in the dialect its
 *     family reads (`schemas.ts`). A schema it refuses is reduced to the
 *     plainest dialect and the request sent again, once.
 *  2. **In words**: a model that takes no tools (the list says so, or the
 *     provider refused them, or refused even the plainest schemas) gets them
 *     listed in the system prompt and asks for them in `<tool_call>` blocks
 *     (`prompted.ts`). Their answers come back as the next user message.
 *  3. **None**: only when the list of tools won't fit the model's window even
 *     in its shortest form. Then, and only then, the chat says it's chat-only.
 *
 * Healing happens before the model has said a word, so nothing is repeated.
 */
import type { EngineEvent } from '../types';
import type { Callable } from './engine';
import { estimateTokens } from './context';
import {
  catalogue,
  promptedHistory,
  promptedResults,
  PromptedReader,
  type CatalogueLevel,
} from './prompted';
import { sanitiseSpecs, type SchemaFamily } from './schemas';
import { ApiError, type ToolSpec, type WireEvent, type WireMessage } from './types';
import type { ToolResult, Wire } from './wire';

export type ToolMode = 'native' | 'prompted' | 'none';

/** What a model taught the engine about its tools, kept between turns. */
export type ToolLessons = Map<string, 'strict' | 'prompted'>;

type Notice = Extract<EngineEvent, { type: 'notice' }>;

/** The shares of the window a list of tools may take, longest listing first. */
const FITS: readonly [CatalogueLevel, number][] = [
  ['full', 0.15],
  ['compact', 0.25],
  ['tiny', 0.4],
];

/**
 * Past this share of the window, the apps' tools wait to be searched for
 * (ADR 0072): Claude Code's own line for deferring tools in its `auto` mode.
 */
export const DEFER_SHARE = 0.1;

export const CHAT_ONLY: Notice = {
  type: 'notice',
  code: 'chat-only',
  message:
    'This model is chat-only: it cannot use files, commands, memory or connected apps. Choose a tool-capable model for actions.',
};

export class ToolPlan {
  mode: ToolMode;
  #strict: boolean;
  #catalogue = '';
  #specs: ToolSpec[];
  #names = new Map<string, string>();

  constructor(
    private readonly options: {
      tools: ReadonlyMap<string, Callable>;
      /** The provider says this model calls tools natively (unknown counts as yes). */
      native: boolean;
      family: SchemaFamily;
      /** The model's window, in tokens, for fitting the list in words. */
      window: number;
      model: string;
      lessons: ToolLessons;
    },
  ) {
    this.#specs = [...options.tools.values()].map((tool) => tool.spec);
    const lesson = options.lessons.get(options.model);
    this.#strict = lesson === 'strict';
    this.mode = !this.#specs.length
      ? 'native'
      : options.native && lesson !== 'prompted'
        ? 'native'
        : this.#inWords();
    this.#index();
  }

  /** Every name the model might write for each tool. */
  #index(): void {
    this.#names.clear();
    for (const [name, tool] of this.options.tools) {
      for (const alias of [name, tool.display, tool.display.split('__').at(-1) ?? name]) {
        const key = alias.toLowerCase();
        // A short name two tools share points at neither.
        if (alias !== name && this.#names.has(key) && this.#names.get(key) !== name)
          this.#names.set(key, '');
        else if (!this.#names.has(key) || alias === name) this.#names.set(key, name);
      }
    }
  }

  /**
   * The tools changed under the plan — lean mode loaded more (ADR 0086) — so
   * read them again, in words too. True when something did.
   */
  refresh(): boolean {
    const specs = [...this.options.tools.values()].map((tool) => tool.spec);
    if (specs.length === this.#specs.length && specs.every((spec, i) => spec === this.#specs[i]))
      return false;
    this.#specs = specs;
    this.#index();
    if (this.mode === 'prompted') this.mode = this.#inWords();
    return true;
  }

  /** Whether the model has tools at all this turn. */
  get usable(): boolean {
    return this.mode !== 'none';
  }

  /** The chat-only notice, when the model has no way to use its tools. */
  get notice(): Notice | undefined {
    return this.mode === 'none' ? CHAT_ONLY : undefined;
  }

  /** The tools sent natively. */
  specs(): ToolSpec[] {
    if (this.mode !== 'native') return [];
    return sanitiseSpecs(this.#specs, this.#strict ? 'strict' : this.options.family);
  }

  /**
   * The apps' tools that may wait until the model searches for them, on a wire
   * that can (`defers`, ADR 0072): only sent natively, only when every tool
   * together would take more than a tenth of the window, and never Conch's own
   * (memory, asking, plans, tasks, the browser), which stay loaded. Worked out
   * from the tools and the window alone, so the same chat gets the same answer
   * on every request and the cached prefix holds.
   */
  deferred(defers: boolean): string[] {
    if (!defers || this.mode !== 'native') return [];
    const apps = [...this.options.tools].flatMap(([name, tool]) => (tool.app ? [name] : []));
    if (!apps.length || apps.length === this.options.tools.size) return [];
    return estimateTokens(this.specs()) > this.options.window * DEFER_SHARE ? apps : [];
  }

  /** The system prompt, with the tools in words when that's how they go. */
  system(base: string): string {
    return this.mode === 'prompted' ? [base, this.#catalogue].filter(Boolean).join('\n\n') : base;
  }

  /** The transcript as this model reads it. */
  history(messages: WireMessage[]): WireMessage[] {
    return this.mode === 'prompted' ? promptedHistory(messages) : messages;
  }

  /** Tool answers, in the shape the model asked in. */
  results(wire: Wire, results: ToolResult[]): WireMessage[] {
    return this.mode === 'prompted'
      ? [wire.userMessage(promptedResults(results))]
      : wire.toolResults(results);
  }

  /**
   * A refusal over tools, healed: a refused schema is simplified once, then
   * the tools go in words. Anything else isn't this plan's to heal.
   */
  heal(error: unknown): { notice?: Notice } | undefined {
    if (!(error instanceof ApiError) || this.mode !== 'native') return undefined;
    if (error.kind === 'schema' && !this.#strict) {
      this.#strict = true;
      this.options.lessons.set(this.options.model, 'strict');
      return {};
    }
    if (error.kind !== 'schema' && error.kind !== 'tools') return undefined;
    this.options.lessons.set(this.options.model, 'prompted');
    this.mode = this.#inWords();
    return this.mode === 'none' ? { notice: CHAT_ONLY } : {};
  }

  /** The list of tools in words, as long as the window allows; none if it can't fit. */
  #inWords(): ToolMode {
    for (const [level, share] of FITS) {
      const text = catalogue(this.#specs, level);
      if (estimateTokens(text) <= this.options.window * share) {
        this.#catalogue = text;
        return 'prompted';
      }
    }
    return 'none';
  }

  /** The name the model wrote, as one of this turn's tools. */
  #resolve = (name: string): string | undefined => this.#names.get(name.toLowerCase()) || undefined;

  /**
   * The model's reply. Natively, as it came. In words, calls are read out of
   * the text: words are passed on as they arrive, a call is held until it
   * closes, and the reply is kept with its calls written the one right way.
   */
  async *read<E extends WireEvent | Notice>(
    events: AsyncIterable<E>,
  ): AsyncGenerator<E | WireEvent> {
    if (this.mode !== 'prompted') {
      yield* events;
      return;
    }
    const reader = new PromptedReader(this.#resolve);
    for await (const event of events) {
      if (event.type === 'text') {
        const shown = reader.push(event.delta);
        if (shown) yield { type: 'text', delta: shown };
        continue;
      }
      if (event.type !== 'end') {
        yield event;
        continue;
      }
      const done = reader.finish();
      if (done.text) yield { type: 'text', delta: done.text };
      const content = event.message['content'];
      const message =
        typeof content === 'string' || (content === null && done.content)
          ? { ...event.message, content: done.content || content }
          : event.message;
      yield {
        ...event,
        message,
        toolCalls: [...event.toolCalls, ...done.calls],
        stop: done.calls.length ? 'tools' : event.stop,
      };
    }
  }
}

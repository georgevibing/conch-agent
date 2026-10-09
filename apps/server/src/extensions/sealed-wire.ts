/**
 * A provider written in code (ADR 0122, `speaks: 'code'`): the engine's
 * `Wire`, answered by the app's own `provider.chat` in its sealed runtime.
 *
 * The contract is small on purpose, and in the shape most of the world
 * already speaks: `messages` and `tools` arrive in OpenAI's chat shape, the
 * answer streams as `app.emit({ type: 'text' | 'thinking', delta })`, and the
 * function returns what it ended with (`toolCalls`, `stop`, `usage`). The
 * transcript keeps that same shape, so a chat can move to any other provider
 * and back. Everything the code sends back is checked here before the engine
 * sees it: it's someone else's code, and its words are the model's.
 *
 * The key the person typed is handed to the sealed process for each call
 * (`app.keys.key`), never in its files, environment or arguments.
 */
import type { AppProviderModel, AppProviderPart } from '@conch/protocol';
import { z } from 'zod';

import type { AppRuntime } from '../conchapps/types';
import type { PartEvent } from '../conchapps/runtime';
import type { Completion, Picture } from '../engines/types';
import { chatToolResults, chatTools, chatUserMessage } from '../engines/api/chat';
import {
  ApiError,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
  type WireStop,
} from '../engines/api/types';
import type { ToolResult, Wire } from '../engines/api/wire';

/** A declared model, as the engine needs one. */
export function wireModel(model: AppProviderModel): WireModel {
  return {
    info: {
      id: model.id,
      label: model.name ?? model.id,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
      ...(model.context && { context: model.context }),
      ...(model.images !== undefined && { images: model.images }),
      ...(model.tools !== undefined && { tools: model.tools }),
    },
    tools: model.tools !== false,
    ...(model.thinking !== undefined && { thinking: model.thinking }),
  };
}

/** What `provider.chat` returns, checked before anything reads it. */
const ChatEnd = z
  .object({
    text: z.string().max(400_000).optional(),
    toolCalls: z
      .array(
        z.object({
          id: z.string().min(1).max(200).optional(),
          name: z.string().min(1).max(200),
          arguments: z
            .union([z.string().max(400_000), z.record(z.string(), z.unknown())])
            .optional(),
        }),
      )
      .max(64)
      .optional(),
    stop: z.enum(['end', 'tools', 'length']).optional(),
    usage: z
      .object({
        input: z.number().int().nonnegative().max(1e9),
        output: z.number().int().nonnegative().max(1e9),
      })
      .optional(),
  })
  .passthrough();

const ModelList = z
  .array(
    z.object({
      id: z.string().min(1).max(200),
      name: z.string().max(80).optional(),
      context: z.number().int().positive().max(20_000_000).optional(),
      tools: z.boolean().optional(),
      images: z.boolean().optional(),
    }),
  )
  .max(200);

/** A failure the sealed code threw, as the kind the engine reacts to. */
export function codeError(label: string, said: string): ApiError {
  const words = said.toLowerCase();
  if (
    /\b(401|403)\b|unauthori[sz]ed|invalid (api )?key|refused (the|your) key|forbidden/.test(words)
  )
    return new ApiError('auth', `${label} refused your key. Add a new one in Settings.`);
  if (/\b402\b|credit|quota|billing|payment/.test(words))
    return new ApiError('payment', `Your ${label} credit has run out. Top up to keep going.`);
  if (/\b429\b|rate.?limit|too many requests/.test(words))
    return new ApiError('rate-limit', `${label} is rate-limiting this key.`, { retryable: true });
  if (/\b(500|502|503|529)\b|overload|unavailable/.test(words))
    return new ApiError('overloaded', `${label} is overloaded right now.`, { retryable: true });
  if (/took longer|timed? ?out|too long/.test(words))
    return new ApiError('timeout', `${label} took too long to answer.`, { retryable: true });
  if (/couldn’t reach|could not reach|network|stopped answering/.test(words))
    return new ApiError('network', `Conch couldn’t reach ${label}. Check your connection.`, {
      retryable: true,
    });
  return new ApiError('other', `${label}: ${said.replace(/\s+/g, ' ').slice(0, 280)}`);
}

export class SealedWire implements Wire {
  readonly source: string;

  constructor(
    private readonly options: {
      label: string;
      part: AppProviderPart;
      runtime: () => Promise<AppRuntime>;
    },
  ) {
    this.source = options.label;
  }

  get #label() {
    return this.options.label;
  }

  async #runtime(): Promise<AppRuntime & Required<Pick<AppRuntime, 'callPart'>>> {
    const runtime = await this.options.runtime();
    if (!runtime.callPart) throw new ApiError('other', `${this.#label} can’t run here.`);
    return runtime as AppRuntime & Required<Pick<AppRuntime, 'callPart'>>;
  }

  async check({ key, signal }: { key: string; signal?: AbortSignal }): Promise<WireAccount> {
    const runtime = await this.#runtime();
    const parts = (await runtime.parts?.()) ?? [];
    // Its own list proves the key cheapest; without one, a single short answer does.
    if (parts.includes('provider.models')) await this.#models(key, signal);
    else
      await this.complete({
        key,
        model: this.options.part.models[0]?.id ?? '',
        system: '',
        prompt: 'Say OK.',
        maxTokens: 8,
        signal: signal ?? new AbortController().signal,
      });
    return { description: this.#label };
  }

  async #models(key: string, signal?: AbortSignal): Promise<z.infer<typeof ModelList>> {
    const runtime = await this.#runtime();
    const outcome = await runtime.callPart(
      'provider.models',
      {},
      {
        keys: key ? { key } : {},
        ...(signal && { signal }),
      },
    );
    if (!outcome.ok) throw codeError(this.#label, outcome.text);
    const list = ModelList.safeParse(outcome.json);
    if (!list.success)
      throw new ApiError('other', `${this.#label} listed its models in a shape Conch can’t read.`);
    return list.data;
  }

  async models({ key, signal }: { key?: string; signal?: AbortSignal }): Promise<WireModel[]> {
    const declared = this.options.part.models;
    const runtime = await this.options.runtime().catch(() => undefined);
    const parts = (await runtime?.parts?.().catch(() => [])) ?? [];
    if (!parts.includes('provider.models') || key === undefined) return declared.map(wireModel);
    try {
      return (await this.#models(key, signal)).map(wireModel);
    } catch {
      return declared.map(wireModel);
    }
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const runtime = await this.#runtime();
    const queue: PartEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const call = runtime
      .callPart(
        'provider.chat',
        {
          model: request.model,
          system: request.system,
          messages: request.messages,
          ...chatTools(request.tools),
          maxTokens: 8192,
          effort: request.effort,
        },
        {
          keys: request.key ? { key: request.key } : {},
          signal: request.signal,
          onEvent: (event) => {
            queue.push(event);
            wake?.();
          },
        },
      )
      .finally(() => {
        finished = true;
        wake?.();
      });
    let said = '';
    for (;;) {
      while (queue.length) {
        const event = queue.shift() as PartEvent;
        if (event.type === 'text') said += event.delta;
        yield event.type === 'text'
          ? { type: 'text', delta: event.delta }
          : { type: 'thinking', delta: event.delta };
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    const outcome = await call;
    if (!outcome.ok) throw codeError(this.#label, outcome.text);
    const end = ChatEnd.safeParse(outcome.json ?? {});
    if (!end.success)
      throw new ApiError('other', `${this.#label} ended its answer in a shape Conch can’t read.`);
    // Text returned rather than streamed counts the same.
    if (end.data.text && !said) {
      said = end.data.text;
      yield { type: 'text', delta: said };
    }
    const toolCalls = (end.data.toolCalls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index + 1}`,
      name: call.name,
      argumentsJson:
        typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
    }));
    const stop: WireStop = end.data.stop ?? (toolCalls.length ? 'tools' : 'end');
    const message: WireMessage = {
      role: 'assistant',
      content: said,
      ...(toolCalls.length && {
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      }),
    };
    yield {
      type: 'end',
      message,
      toolCalls,
      stop,
      ...(end.data.usage && {
        usage: { inputTokens: end.data.usage.input, outputTokens: end.data.usage.output },
      }),
    };
  }

  async complete(request: WireCompletion): Promise<Completion> {
    let said = '';
    let usage: Completion['usage'];
    for await (const event of this.stream({
      key: request.key,
      model: request.model,
      system: request.system,
      messages: [this.userMessage(request.prompt, request.images)],
      tools: [],
      effort: 'auto',
      signal: request.signal,
    })) {
      if (event.type === 'text') said += event.delta;
      if (event.type === 'end' && event.usage)
        usage = { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens };
    }
    return { text: said, ...(usage && { usage }) };
  }

  userMessage(text: string, images?: readonly Picture[]): WireMessage {
    return chatUserMessage(text, images);
  }

  toolResults(results: ToolResult[]): WireMessage[] {
    return chatToolResults(results);
  }

  smallModel(): string | undefined {
    return this.options.part.small;
  }

  toolsFor(model: string): boolean | undefined {
    return this.options.part.models.find((m) => m.id === model)?.tools;
  }

  seesFor(model: string): boolean | undefined {
    return this.options.part.models.find((m) => m.id === model)?.images;
  }
}

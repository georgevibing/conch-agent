/**
 * A provider a Conch app brings, as one of Conch's own (ADR 0119): the same
 * `ApiEngine` every model API runs on, so the model picker, Settings →
 * Providers, keys, limits, the fallback, long chats, tools on every model and
 * spending all work with it unchanged. What differs is the wire:
 *
 * - **Declared** (`speaks: 'openai' | 'anthropic'`): the shared chat adapters
 *   pointed at its address, reaching it only through `partFetch` (its own
 *   hosts, the SSRF guard, its key the way it declared). Its models are the
 *   ones it lists, or read live from the address.
 * - **Code** (`speaks: 'code'`): `SealedWire`, its `provider.chat` run in the
 *   app's sealed runtime.
 *
 * Either way a declared price per million tokens is what its spend is counted
 * with (`PricedWire`).
 */
import type { AppProviderModel, AppProviderPart, ConchAppManifest } from '@conch/protocol';

import { AnthropicWire, type AnthropicRoute } from '../engines/api/anthropic';
import { OpenAiWire, type ChatPreset } from '../engines/api/openai';
import { defaultHome } from '../engines/api/session';
import {
  ApiError,
  type ApiVariant,
  type FetchLike,
  type WireEvent,
  type WireRequest,
} from '../engines/api/types';
import { send, text, validate, type Wire } from '../engines/api/wire';
import { z } from 'zod';
import { SealedWire } from './sealed-wire';

export { wireModel } from './sealed-wire';
import type { AppRuntime } from '../conchapps/types';

/** What a provider part needs to become an engine. */
export interface ProviderSource {
  /** `app-<id>`. */
  engineId: `app-${string}`;
  manifest: ConchAppManifest & { provider: AppProviderPart };
  /** The app's sealed runtime, for `speaks: 'code'`. */
  runtime: () => Promise<AppRuntime>;
  /** The provider's fetch (`partFetch`), for a declared one. */
  fetch: FetchLike;
  home?: string;
}

/** Anthropic's Messages API version every compatible server speaks. */
const ANTHROPIC_VERSION = '2023-06-01';

/** The name it goes by: its own, or its app's. */
export const providerName = (manifest: Pick<ConchAppManifest, 'name' | 'provider'>) =>
  manifest.provider?.name ?? manifest.name;

/** A declared model, as the shared adapters read one from a provider's own list. */
function listEntry(model: AppProviderModel): Record<string, unknown> {
  return {
    id: model.id,
    ...(model.name && { display_name: model.name }),
    ...(model.context && { context_length: model.context }),
    capabilities: {
      ...(model.tools !== undefined && { tools: model.tools }),
      ...(model.images !== undefined && { vision: model.images }),
      ...(model.thinking !== undefined && { reasoning: model.thinking }),
    },
    type: 'chat',
  };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** OpenAI's chat shape, at the address it declared. */
function openAiWire(source: ProviderSource): Wire {
  const { manifest } = source;
  const part = manifest.provider;
  const preset: ChatPreset = {
    id: source.engineId,
    label: providerName(manifest),
    endpoints: [{ id: 'app', base: part.address ?? '' }],
    ...(part.auth === 'none' || part.key?.optional ? { key: 'optional' as const } : {}),
    ...(part.models.length && { listModels: async () => part.models.map(listEntry) }),
    ...(part.small && { small: new RegExp(`^${escape(part.small)}$`) }),
    ...(part.models.some((m) => m.images) && {
      sees: new RegExp(
        `^(?:${part.models
          .filter((m) => m.images)
          .map((m) => escape(m.id))
          .join('|')})$`,
      ),
    }),
    ...(part.models.some((m) => m.tools === false) && {
      noTools: new RegExp(
        `^(?:${part.models
          .filter((m) => m.tools === false)
          .map((m) => escape(m.id))
          .join('|')})$`,
      ),
    }),
    // A declared list proves nothing about a key: a short look at the live one does.
    ...(part.models.length && part.auth !== 'none' && { checkPath: '/models' }),
    // Open models on servers like these often think inside <think> tags.
    thinkTags: true,
  };
  return new OpenAiWire(preset, source.fetch);
}

const ModelsPage = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().nullish() }).passthrough()),
});

/** Anthropic's Messages shape, at the address it declared. */
function anthropicWire(source: ProviderSource): Wire {
  const { manifest } = source;
  const part = manifest.provider;
  const base = part.address ?? '';
  const label = providerName(manifest);
  const headers = (key: string, beta?: string): Record<string, string> => ({
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    ...(part.auth !== 'none' && key && { authorization: `Bearer ${key}` }),
    ...(beta && { 'anthropic-beta': beta }),
  });
  const list = async (key: string, signal?: AbortSignal): Promise<unknown[]> => {
    if (part.models.length && !key)
      return part.models.map((m) => ({ id: m.id, display_name: m.name ?? m.id }));
    const response = await send({
      fetchImpl: source.fetch,
      url: `${base}/v1/models?limit=1000`,
      method: 'GET',
      headers: headers(key),
      label,
      key,
      ...(signal && { signal }),
    });
    if (response.status === 401 || response.status === 403)
      throw new ApiError('auth', `${label} refused your key. Add a new one in Settings.`);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      // A server with no list of its own: the models it declared are the list.
      if (part.models.length)
        return part.models.map((m) => ({ id: m.id, display_name: m.name ?? m.id }));
      throw new ApiError('other', `${label} didn’t list its models.`);
    }
    const page = validate(ModelsPage, await text(response, label), label);
    return part.models.length
      ? part.models.map((m) => ({ id: m.id, display_name: m.name ?? m.id }))
      : page.data;
  };
  const route: AnthropicRoute = {
    voice: { label, refused: `${label} refused your key. Add a new one in Settings.` },
    prepare: async ({ kind, body, key, beta }) => ({
      url: `${base}/v1/messages${kind === 'count' ? '/count_tokens' : ''}`,
      headers: headers(key, beta),
      body,
    }),
    list: ({ key, signal }) => list(key, signal),
    check: async ({ key, signal }) => {
      await list(key, signal);
      return { description: label };
    },
  };
  return new AnthropicWire(source.fetch, route);
}

/**
 * A wire whose spend is counted at the price the provider declared, per
 * million tokens, wherever the provider itself doesn't say what it cost.
 */
export class PricedWire implements Wire {
  constructor(
    private readonly inner: Wire,
    private readonly prices: ReadonlyMap<string, { input: number; output: number }>,
  ) {}

  get source() {
    return this.inner.source;
  }
  get narrates() {
    return this.inner.narrates;
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const price = this.prices.get(request.model);
    for await (const event of this.inner.stream(request)) {
      if (event.type === 'end' && price && event.usage && event.usage.costUsd === undefined)
        yield {
          ...event,
          usage: {
            ...event.usage,
            costUsd:
              (event.usage.inputTokens * price.input + event.usage.outputTokens * price.output) /
              1_000_000,
          },
        };
      else yield event;
    }
  }

  check: Wire['check'] = (input) => this.inner.check(input);
  models: Wire['models'] = (input) => this.inner.models(input);
  complete: Wire['complete'] = (input) => this.inner.complete(input);
  userMessage: Wire['userMessage'] = (content, images) => this.inner.userMessage(content, images);
  toolResults: Wire['toolResults'] = (results) => this.inner.toolResults(results);
  smallModel: Wire['smallModel'] = () => this.inner.smallModel();
  toolsFor: NonNullable<Wire['toolsFor']> = (model) => this.inner.toolsFor?.(model);
  seesFor: NonNullable<Wire['seesFor']> = (model) => this.inner.seesFor?.(model);
  schemaFamily: NonNullable<Wire['schemaFamily']> = (model) =>
    this.inner.schemaFamily?.(model) ?? 'permissive';
}

/** The wire for a provider part, by how it speaks. */
export function partWire(source: ProviderSource): Wire {
  const part = source.manifest.provider;
  const inner =
    part.speaks === 'openai'
      ? openAiWire(source)
      : part.speaks === 'anthropic'
        ? anthropicWire(source)
        : new SealedWire({
            label: providerName(source.manifest),
            part,
            runtime: source.runtime,
          });
  const prices = new Map(part.models.flatMap((m) => (m.price ? [[m.id, m.price] as const] : [])));
  return prices.size ? new PricedWire(inner, prices) : inner;
}

/** The provider part as `ApiEngine` runs one. */
export function partVariant(source: ProviderSource): ApiVariant {
  const { manifest } = source;
  const part = manifest.provider;
  const site = `https://${manifest.reaches[0] ?? 'example.com'}`;
  return {
    id: source.engineId,
    label: providerName(manifest),
    docsUrl: manifest.author?.url ?? site,
    keyUrl: part.key?.link ?? site,
    canSignIn: false,
    ...(part.auth === 'none' && { keyless: true }),
    ...(part.key?.optional && { keyOptional: true }),
    wire: partWire(source),
    home: source.home ?? defaultHome(),
  };
}

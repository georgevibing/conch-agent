/**
 * Who can make a picture, in the order Conch asks them: what the person's own
 * providers can do first (a plan they already pay for, then a key of theirs
 * that bills per picture), and OpenRouter last. `ImageService` picks one,
 * asks when it costs money, and falls back only when nothing was made.
 */
import { z } from 'zod';
import type { EngineId, Usage } from '@conch/protocol';

import { sseEvents } from '../engines/api/sse';
import { PictureLimit, type Picture, type PictureMaker } from '../engines/types';

/** The keys Conch makes pictures with, each a provider the person connected. */
export type ImageKeyId = 'openai' | 'gemini' | 'openrouter';

export interface MakeInput {
  prompt: string;
  source?: Picture;
  aspect_ratio?: string;
  background?: 'auto' | 'transparent' | 'opaque';
  signal: AbortSignal;
  /** The provider started on it (after waiting its turn). */
  onStarted?: () => void;
  /** A rough picture so far: the `index`th of `of` before the final one. */
  onPartial?: (bytes: Buffer, index: number, of: number) => void;
}

export interface Made {
  bytes: Buffer;
  usage?: Usage;
}

/** A model a backend offers, for `image_models`. */
export interface ImageModelInfo {
  id: string;
  name?: string;
  canEdit: boolean;
  settings?: Record<string, unknown>;
}

export interface ImageBackend {
  /** `plan:<engine>`, or the key it uses. */
  id: string;
  /** Who makes it, in a few words, for the card and the progress line. */
  by: string;
  /** Where the prompt (and a source picture) go, when that's not `by`: "OpenAI". */
  to?: string;
  /** `included` in a plan the person has anyway; `paid` per picture. */
  cost: 'included' | 'paid';
  /** How long a picture usually takes here, for an honest estimate. */
  typicalMs: number;
  /** It sends rough pictures as it goes (real progress). */
  partials?: boolean;
  /** It says when it starts (`onStarted`), after waiting its turn; otherwise it starts when sent. */
  startsLater?: boolean;
  /** Spending is recorded against this provider. */
  spendAs?: EngineId;
  /** A model id the person or the assistant named belongs here. */
  claims(model: string): boolean;
  /** The models it offers now. */
  models(signal: AbortSignal): Promise<ImageModelInfo[]>;
  /**
   * Choose the model for this request and check the request fits it, before
   * anything is sent. Throws `Unfit` when it can't do what's asked.
   */
  prepare(
    input: Omit<MakeInput, 'signal'> & { model?: string },
    signal: AbortSignal,
  ): Promise<{ model: string; costUsd?: number; run: (input: MakeInput) => Promise<Made> }>;
}

/** This backend can't do what's asked (a setting, editing): another one may. Nothing was sent. */
export class Unfit extends Error {}

/** Nothing was made, for certain (a limit, a refused key): another backend may try. */
export class NotMade extends Error {}

const SUPPORTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Limit decoded response bytes too; Content-Length alone does not bound streamed or compressed JSON. */
export async function boundedJson(response: Response, max: number): Promise<unknown> {
  if (!response.body) throw new Error('The image service sent an empty response.');
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > max)
        throw new Error('The image service returned more than Conch can safely read.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function decoded(b64: string): Buffer {
  if (!BASE64.test(b64)) throw new Error('The image service returned invalid image data.');
  return Buffer.from(b64, 'base64');
}

/** What a refused request means, said so the model (and the person) can act on it. */
function refused(by: string, status: number, where: string): Error {
  const message =
    status === 401 || status === 403
      ? `Reconnect ${by} in Settings → Providers.`
      : status === 402
        ? `${by} needs credit before it can make this picture.`
        : status === 429
          ? `${by} is busy or at its limit. Wait before trying again.`
          : status === 400
            ? `${by} refused this request. Change the description or settings and try once more.`
            : `${where} returned ${status}. No image was received.`;
  // Refused before any work: nothing was made, so another way may try.
  return [400, 401, 402, 403, 429].includes(status) ? new NotMade(message) : new Error(message);
}

const square = (ratio?: string) =>
  !ratio || ratio === '1:1'
    ? '1024x1024'
    : ['16:9', '4:3', '3:2'].includes(ratio)
      ? '1536x1024'
      : '1024x1536';

/** About what a picture costs, said on the card. A guess from public prices, never billed by Conch. */
export function aboutCost(model: string): number | undefined {
  if (/flash-image|gemini-2\.5-flash/.test(model)) return 0.04;
  if (/gpt-image-1-mini/.test(model)) return 0.01;
  if (/gpt-image|dall-e-3/.test(model)) return 0.05;
  if (/flux/.test(model)) return 0.04;
  return undefined;
}

// --- Your plan: a provider's own image tool (Codex on ChatGPT) ---

export function planBackend(
  engine: EngineId,
  maker: PictureMaker,
  offer: { cost: 'included' | 'paid'; by: string; to?: string },
): ImageBackend {
  return {
    id: `plan:${engine}`,
    by: offer.by,
    ...(offer.to && { to: offer.to }),
    spendAs: engine,
    cost: offer.cost,
    // ChatGPT's image tool takes about a minute for a picture.
    typicalMs: 60_000,
    startsLater: true,
    claims: (model) => model === 'chatgpt',
    models: async () => [{ id: 'chatgpt', name: offer.by, canEdit: true }],
    prepare: async () => ({
      model: 'chatgpt',
      run: async (input) => {
        try {
          const made = await maker.make({
            prompt: input.prompt,
            ...(input.source && { source: input.source }),
            ...(input.aspect_ratio && { aspectRatio: input.aspect_ratio }),
            ...(input.background && { background: input.background }),
            signal: input.signal,
            ...(input.onStarted && { onStarted: input.onStarted }),
          });
          return { bytes: made.bytes };
        } catch (error) {
          if (error instanceof PictureLimit) throw new NotMade(error.message);
          throw error;
        }
      },
    }),
  };
}

// --- OpenAI, with the person's API key: GPT Image ---

const OPENAI = 'https://api.openai.com/v1';
const OpenAiModels = z.object({ data: z.array(z.object({ id: z.string().max(200) })).max(2000) });
const OpenAiImage = z.object({
  b64_json: z.string().max(42_000_000),
});
const OpenAiResult = z.object({
  data: z.array(OpenAiImage).min(1).max(10),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
/** A streamed event: `image_generation.partial_image`, `image_edit.completed`, … */
const OpenAiStreamed = z.object({
  type: z.string().max(100),
  b64_json: z.string().max(42_000_000).optional(),
  partial_image_index: z.number().int().nonnegative().optional(),
  usage: OpenAiResult.shape.usage,
});
/** Rough pictures asked for while it works (0–3). */
const PARTIALS = 2;

export function openAiBackend(
  key: (signal: AbortSignal) => Promise<string | undefined>,
  fetcher: typeof fetch,
): ImageBackend {
  let listed: { at: number; ids: string[] } | undefined;
  const list = async (signal: AbortSignal) => {
    if (listed && Date.now() - listed.at < 10 * 60_000) return listed.ids;
    const secret = await key(signal);
    if (!secret) return [];
    const response = await fetcher(`${OPENAI}/models`, {
      redirect: 'error',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    }).catch(() => undefined);
    if (!response?.ok) {
      await response?.body?.cancel();
      return [];
    }
    const ids = OpenAiModels.safeParse(await boundedJson(response, 2_000_000).catch(() => null));
    const found = ids.success
      ? ids.data.data.map((m) => m.id).filter((id) => /^gpt-image-/.test(id))
      : [];
    listed = { at: Date.now(), ids: found };
    return found;
  };
  return {
    id: 'openai',
    by: 'OpenAI',
    cost: 'paid',
    typicalMs: 45_000,
    partials: true,
    spendAs: 'openai',
    claims: (model) => /^gpt-image-|^dall-e-/.test(model),
    models: async (signal) =>
      (await list(signal)).map((id) => ({
        id,
        canEdit: true,
        settings: {
          aspect_ratio: {
            type: 'enum',
            values: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
          },
          background: {
            type: 'enum',
            values: id === 'gpt-image-2' ? ['auto', 'opaque'] : ['auto', 'transparent', 'opaque'],
          },
        },
      })),
    prepare: async (input, signal) => {
      const ids = await list(signal);
      const transparent = input.background === 'transparent';
      // GPT Image 2 makes no transparent backgrounds; the one before it does.
      const preferred = transparent
        ? ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']
        : ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];
      const model =
        input.model ?? preferred.find((id) => ids.includes(id)) ?? ids[0] ?? 'gpt-image-1';
      if (transparent && model === 'gpt-image-2')
        throw new Unfit('gpt-image-2 makes no transparent backgrounds. Choose gpt-image-1.5.');
      const cost = aboutCost(model);
      return {
        model,
        ...(cost !== undefined && { costUsd: cost }),
        run: (made) => openAiImage(model, made, key, fetcher),
      };
    },
  };
}

async function openAiImage(
  model: string,
  input: MakeInput,
  key: (signal: AbortSignal) => Promise<string | undefined>,
  fetcher: typeof fetch,
): Promise<Made> {
  const secret = await key(input.signal);
  if (!secret) throw new NotMade('Reconnect OpenAI in Settings → Providers.');
  const editing = Boolean(input.source);
  const send = (stream: boolean) => {
    const fields: Record<string, string> = {
      model,
      prompt: input.prompt,
      n: '1',
      size: square(input.aspect_ratio),
      ...(input.background && input.background !== 'auto' && { background: input.background }),
      ...(stream && { stream: 'true', partial_images: String(PARTIALS) }),
    };
    let body: string | FormData;
    const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
    if (input.source) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      const extension = input.source.mimeType.split('/')[1] ?? 'png';
      form.set(
        'image',
        new Blob([Buffer.from(input.source.data, 'base64')], { type: input.source.mimeType }),
        `source.${extension}`,
      );
      body = form;
    } else {
      body = JSON.stringify({
        ...fields,
        n: 1,
        ...(stream && { stream: true, partial_images: PARTIALS }),
      });
      headers['content-type'] = 'application/json';
    }
    return fetcher(`${OPENAI}/images/${editing ? 'edits' : 'generations'}`, {
      method: 'POST',
      redirect: 'error',
      headers,
      body,
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(240_000)]),
    });
  };
  let response: Response;
  try {
    response = await send(true);
    // A model that can't stream says so before any work: ask again, whole.
    if (response.status === 400) {
      await response.body?.cancel();
      response = await send(false);
    }
  } catch {
    input.signal.throwIfAborted();
    throw new Error(
      'The image request did not finish. Check OpenAI’s usage page before requesting another image.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw refused('OpenAI', response.status, 'The image service');
  }
  const usageOf = (u?: { input_tokens?: number; output_tokens?: number }): Usage => ({
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
  });
  if (!/text\/event-stream/.test(response.headers.get('content-type') ?? '')) {
    const result = OpenAiResult.parse(await boundedJson(response, 43_000_000));
    return { bytes: decoded(result.data[0]?.b64_json ?? ''), usage: usageOf(result.usage) };
  }
  if (!response.body) throw new Error('The image service sent an empty response.');
  for await (const frame of sseEvents(response.body, input.signal)) {
    if (frame.data === '[DONE]') continue;
    let parsed;
    try {
      parsed = OpenAiStreamed.safeParse(JSON.parse(frame.data));
    } catch {
      continue;
    }
    if (!parsed.success) continue;
    const event = parsed.data;
    if (/\.partial_image$/.test(event.type) && event.b64_json)
      input.onPartial?.(decoded(event.b64_json), event.partial_image_index ?? 0, PARTIALS);
    else if (/\.completed$/.test(event.type) && event.b64_json)
      return { bytes: decoded(event.b64_json), usage: usageOf(event.usage) };
    else if (/error|failed/.test(event.type))
      throw new Error('OpenAI stopped before the picture was finished. No image was received.');
  }
  throw new Error('OpenAI’s answer ended before the picture. No image was received.');
}

// --- Gemini, with the person's Google AI Studio key ---

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const GeminiModels = z.object({
  models: z
    .array(
      z.object({
        name: z.string().max(200),
        displayName: z.string().max(200).optional(),
        supportedGenerationMethods: z.array(z.string()).optional(),
      }),
    )
    .max(2000)
    .optional(),
});
const GeminiAnswer = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  inlineData: z
                    .object({ mimeType: z.string(), data: z.string().max(42_000_000) })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export function geminiBackend(
  key: (signal: AbortSignal) => Promise<string | undefined>,
  fetcher: typeof fetch,
): ImageBackend {
  let listed: { at: number; models: { id: string; name?: string }[] } | undefined;
  const list = async (signal: AbortSignal) => {
    if (listed && Date.now() - listed.at < 10 * 60_000) return listed.models;
    const secret = await key(signal);
    if (!secret) return [];
    const response = await fetcher(`${GEMINI}/models?pageSize=1000`, {
      redirect: 'error',
      headers: { 'x-goog-api-key': secret },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    }).catch(() => undefined);
    if (!response?.ok) {
      await response?.body?.cancel();
      return [];
    }
    const parsed = GeminiModels.safeParse(await boundedJson(response, 4_000_000).catch(() => null));
    const models = parsed.success
      ? (parsed.data.models ?? [])
          .filter(
            (m) =>
              /image/.test(m.name) &&
              (m.supportedGenerationMethods ?? []).includes('generateContent'),
          )
          .map((m) => ({
            id: m.name.replace(/^models\//, ''),
            ...(m.displayName && { name: m.displayName }),
          }))
      : [];
    listed = { at: Date.now(), models };
    return models;
  };
  return {
    id: 'gemini',
    by: 'Gemini',
    cost: 'paid',
    typicalMs: 15_000,
    spendAs: 'gemini',
    claims: (model) => /^(?:gemini|imagen)-/.test(model),
    models: async (signal) =>
      (await list(signal)).map((m) => ({
        ...m,
        canEdit: true,
        settings: {
          aspect_ratio: {
            type: 'enum',
            values: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
          },
        },
      })),
    prepare: async (input, signal) => {
      if (input.background === 'transparent')
        throw new Unfit('Gemini makes no transparent backgrounds.');
      const models = (await list(signal)).map((m) => m.id);
      const preferred = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'];
      const model =
        input.model ??
        preferred.find((id) => models.includes(id)) ??
        models[0] ??
        'gemini-2.5-flash-image';
      const cost = aboutCost(model);
      return {
        model,
        ...(cost !== undefined && { costUsd: cost }),
        run: (made) => geminiImage(model, made, key, fetcher),
      };
    },
  };
}

async function geminiImage(
  model: string,
  input: MakeInput,
  key: (signal: AbortSignal) => Promise<string | undefined>,
  fetcher: typeof fetch,
): Promise<Made> {
  const secret = await key(input.signal);
  if (!secret) throw new NotMade('Reconnect Gemini in Settings → Providers.');
  let response: Response;
  try {
    response = await fetcher(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'x-goog-api-key': secret, 'content-type': 'application/json' },
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(180_000)]),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: input.prompt },
              ...(input.source
                ? [{ inlineData: { mimeType: input.source.mimeType, data: input.source.data } }]
                : []),
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(input.aspect_ratio && { imageConfig: { aspectRatio: input.aspect_ratio } }),
        },
      }),
    });
  } catch {
    input.signal.throwIfAborted();
    throw new Error(
      'The image request did not finish. Check your Gemini usage before requesting another image.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw refused('Gemini', response.status, 'Gemini');
  }
  const answer = GeminiAnswer.parse(await boundedJson(response, 43_000_000));
  const picture = answer.candidates
    ?.flatMap((c) => c.content?.parts ?? [])
    .find((part) => part.inlineData && SUPPORTED.includes(part.inlineData.mimeType))?.inlineData;
  if (!picture)
    throw new NotMade(
      'Gemini answered without a picture (it may have declined the description). Nothing was made.',
    );
  return {
    bytes: decoded(picture.data),
    usage: {
      inputTokens: answer.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: answer.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// --- OpenRouter: the paid way, when none of your own providers can ---

const OPENROUTER = 'https://openrouter.ai/api/v1';
const RouterModels = z.object({
  data: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(200).optional(),
        architecture: z.object({
          input_modalities: z.array(z.string()),
          output_modalities: z.array(z.string()),
        }),
        supported_parameters: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(1000),
});
type RouterModel = z.infer<typeof RouterModels>['data'][number];
const RouterResult = z.object({
  data: z
    .array(z.object({ b64_json: z.string().max(42_000_000), media_type: z.string().optional() }))
    .min(1)
    .max(10),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

export function openRouterBackend(
  key: (signal: AbortSignal) => Promise<string | undefined>,
  fetcher: typeof fetch,
): ImageBackend {
  const list = async (signal: AbortSignal): Promise<RouterModel[]> => {
    const response = await fetcher(`${OPENROUTER}/images/models`, {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error('The image model list is unavailable. Try again shortly.');
    return RouterModels.parse(await boundedJson(response, 2_000_000)).data.filter((m) =>
      m.architecture.output_modalities.includes('image'),
    );
  };
  return {
    id: 'openrouter',
    by: 'OpenRouter',
    cost: 'paid',
    typicalMs: 25_000,
    spendAs: 'openrouter',
    claims: (model) => model.includes('/'),
    models: async (signal) =>
      (await list(signal)).map((m) => ({
        id: m.id,
        ...(m.name && { name: m.name }),
        canEdit: m.architecture.input_modalities.includes('image'),
        ...(m.supported_parameters && { settings: m.supported_parameters }),
      })),
    prepare: async (input, signal) => {
      const editing = Boolean(input.source);
      const models = (await list(signal)).filter(
        (m) => !editing || m.architecture.input_modalities.includes('image'),
      );
      const preferred = [
        'google/gemini-2.5-flash-image',
        'black-forest-labs/flux.2-pro',
        'openai/gpt-image-1',
      ];
      const model = input.model
        ? models.find((m) => m.id === input.model)
        : (preferred.map((id) => models.find((m) => m.id === id)).find(Boolean) ?? models[0]);
      if (!model)
        throw new Unfit(
          'That image model is not available for this request. Use image_models to choose an available model.',
        );
      for (const field of ['aspect_ratio', 'background'] as const) {
        if (input[field] === undefined) continue;
        const descriptor = z
          .object({ type: z.string(), values: z.array(z.string()).optional() })
          .safeParse(model.supported_parameters?.[field]);
        if (
          !descriptor.success ||
          (descriptor.data.values && !descriptor.data.values.includes(String(input[field])))
        )
          throw new Unfit(
            `This model does not support the requested ${field.replace('_', ' ')}. Choose another model with image_models.`,
          );
      }
      const cost = aboutCost(model.id);
      return {
        model: model.id,
        ...(cost !== undefined && { costUsd: cost }),
        run: (made) => openRouterImage(model.id, made, key, fetcher),
      };
    },
  };
}

async function openRouterImage(
  model: string,
  input: MakeInput,
  key: (signal: AbortSignal) => Promise<string | undefined>,
  fetcher: typeof fetch,
): Promise<Made> {
  const secret = await key(input.signal);
  if (!secret) throw new NotMade('OpenRouter needs reconnecting in Settings → Providers.');
  let response: Response;
  try {
    response = await fetcher(`${OPENROUTER}/images`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(180_000)]),
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        n: 1,
        stream: false,
        ...(input.source && {
          input_references: [
            {
              type: 'image_url',
              image_url: { url: `data:${input.source.mimeType};base64,${input.source.data}` },
            },
          ],
        }),
        ...(input.aspect_ratio !== undefined && { aspect_ratio: input.aspect_ratio }),
        ...(input.background !== undefined && { background: input.background }),
      }),
    });
  } catch {
    input.signal.throwIfAborted();
    throw new Error(
      'The image request did not finish. Check OpenRouter’s activity before requesting another image.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw refused('OpenRouter', response.status, 'The image service');
  }
  const result = RouterResult.parse(await boundedJson(response, 43_000_000));
  const first = result.data[0];
  if (!first) throw new Error('The image service returned no image.');
  return {
    bytes: decoded(first.b64_json),
    usage: {
      inputTokens: result.usage?.prompt_tokens ?? 0,
      outputTokens: result.usage?.completion_tokens ?? 0,
      ...(result.usage?.cost !== undefined && { costUsd: result.usage.cost }),
    },
  };
}

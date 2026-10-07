import { z } from 'zod';
import type { Usage } from '@conch/protocol';

import { sniff } from '../attachments/sniff';
import type { AttachmentStore } from '../attachments/store';
import type { ToolContext } from '../conversations/manager';
import { trustsFully } from '../engines/trust';
import type { FileAccess } from '../engines/host';
import type { HostTool, HostToolResult, ToolImage } from '../engines/types';
import { fileBytes } from '../files/read';

const BASE = 'https://openrouter.ai/api/v1';
const Models = z.object({
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
const Generated = z.object({
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
const MESSAGE =
  'Image creation uses your OpenRouter API key and is billed separately from your chat model.';

/** Limit decoded response bytes too; Content-Length alone does not bound streamed or compressed JSON. */
async function json(response: Response, max: number) {
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

export interface ImageDeps {
  key: (signal: AbortSignal) => Promise<string | undefined>;
  hasKey: () => Promise<boolean>;
  overBudget: () => Promise<boolean>;
  spend: (usage: Usage) => Promise<unknown>;
  store: AttachmentStore;
  fetch?: typeof fetch;
  offer: (ctx: ToolContext) => Promise<string>;
}

/** The one picture for a face being made at a time (beside one per chat). */
const FACE = ' face';

export class ImageService {
  readonly #running = new Set<string>();
  constructor(private readonly deps: ImageDeps) {}
  async #models(signal: AbortSignal) {
    const response = await (this.deps.fetch ?? fetch)(`${BASE}/images/models`, {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error('The image model list is unavailable. Try again shortly.');
    return Models.parse(await json(response, 2_000_000)).data.filter((m) =>
      m.architecture.output_modalities.includes('image'),
    );
  }
  /** One picture from OpenRouter: the request, the bounded answer, its cost recorded. */
  async #generate(input: {
    model: string;
    prompt: string;
    reference?: string;
    aspect_ratio?: string;
    background?: string;
    signal: AbortSignal;
  }): Promise<{ bytes: Buffer; type: { mimeType: string }; usage: Usage }> {
    const key = await this.deps.key(input.signal);
    if (!key) throw new Error('OpenRouter needs reconnecting in Settings → Providers.');
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(`${BASE}/images`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(180_000)]),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          n: 1,
          stream: false,
          ...(input.reference && {
            input_references: [{ type: 'image_url', image_url: { url: input.reference } }],
          }),
          ...(input.aspect_ratio !== undefined && { aspect_ratio: input.aspect_ratio }),
          ...(input.background !== undefined && { background: input.background }),
        }),
      });
    } catch {
      throw new Error(
        'The image request did not finish. Check OpenRouter’s activity before requesting another image.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401
          ? 'Reconnect OpenRouter in Settings → Providers.'
          : response.status === 402
            ? 'OpenRouter needs API credit before it can make this picture.'
            : response.status === 429
              ? 'OpenRouter is busy or at its limit. Wait before trying again.'
              : `The image service returned ${response.status}. No image was received.`,
      );
    }
    const result = Generated.parse(await json(response, 43_000_000));
    const usage: Usage = {
      inputTokens: result.usage?.prompt_tokens ?? 0,
      outputTokens: result.usage?.completion_tokens ?? 0,
      ...(result.usage?.cost !== undefined && { costUsd: result.usage.cost }),
    };
    await this.deps.spend(usage).catch(() => undefined);
    const first = result.data[0];
    if (!first) throw new Error('The image service returned no image.');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(first.b64_json))
      throw new Error('The image service returned invalid image data.');
    const bytes = Buffer.from(first.b64_json, 'base64');
    const type = sniff(bytes, 'image', undefined);
    if (
      type.kind !== 'image' ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type.mimeType)
    )
      throw new Error('The service returned a file that is not a supported raster image.');
    return { bytes, type, usage };
  }

  /** Whether a picture can be made at all (an agent's face, ADR 0101): an OpenRouter key. */
  async canMake(): Promise<boolean> {
    return this.deps.hasKey().catch(() => false);
  }

  /**
   * A square picture for an agent's face (ADR 0101), asked for by a person on
   * the page, never by the assistant. Over the monthly budget it doesn't go.
   * One at a time; the bytes go back to the page and are kept nowhere.
   */
  async face(
    prompt: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer; mimeType: string; costUsd?: number }> {
    if (!(await this.canMake()))
      throw new Error('Connect OpenRouter in Settings → Providers to make a picture.');
    if (await this.deps.overBudget())
      throw new Error('Your monthly budget has been reached. Review it in Settings first.');
    if (this.#running.has(FACE)) throw new Error('A picture is already being made. Wait for it.');
    this.#running.add(FACE);
    try {
      const models = await this.#models(signal);
      const preferred = ['google/gemini-2.5-flash-image', 'openai/gpt-image-1'];
      const model =
        preferred.map((id) => models.find((m) => m.id === id)).find(Boolean) ?? models[0];
      if (!model) throw new Error('No image model is available just now. Try again later.');
      const square = z
        .object({ values: z.array(z.string()).optional() })
        .safeParse(model.supported_parameters?.aspect_ratio);
      const made = await this.#generate({
        model: model.id,
        prompt,
        ...(square.success && (!square.data.values || square.data.values.includes('1:1'))
          ? { aspect_ratio: '1:1' }
          : {}),
        signal,
      });
      return {
        bytes: made.bytes,
        mimeType: made.type.mimeType,
        ...(made.usage.costUsd !== undefined && { costUsd: made.usage.costUsd }),
      };
    } finally {
      this.#running.delete(FACE);
    }
  }

  tools(ctx: ToolContext, access: () => Promise<FileAccess>): HostTool[] {
    return [
      {
        name: 'image_models',
        row: true,
        description:
          'List available image-generation models and supported settings from OpenRouter. Works independently of the model answering this chat. Image generation needs an OpenRouter API key and is billed separately; image_generate offers connection when missing.',
        input: {},
        run: async () =>
          JSON.stringify(
            (await this.#models(ctx.signal)).map((m) => ({
              id: m.id,
              name: m.name,
              canEdit: m.architecture.input_modalities.includes('image'),
              settings: m.supported_parameters,
            })),
          ),
      },
      {
        name: 'image_generate',
        row: true,
        description:
          'Create or edit one raster image and show it as a preview/download card. Describe the image in prompt. For editing, pass a source image path from this work folder or chat attachments. Uses a connected OpenRouter API key, regardless of the chat model, and is billed separately. Offers setup when missing. Discover optional model/settings with image_models. Never retry a generation automatically after an uncertain failure.',
        input: {
          prompt: z.string().trim().min(1).max(12_000),
          name: z.string().min(1).max(200).default('Generated image'),
          model: z.string().min(1).max(200).optional(),
          source: z.string().min(1).max(4096).optional(),
          aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']).optional(),
          background: z.enum(['auto', 'transparent', 'opaque']).optional(),
        },
        run: async (args) => {
          if (ctx.permissionMode === 'plan')
            throw new Error('Leave plan mode before generating an image.');
          if (!(await this.deps.hasKey())) return this.deps.offer(ctx);
          if (await this.deps.overBudget())
            throw new Error(
              'Your monthly budget has been reached. Review it in Settings before creating more images.',
            );
          if (this.#running.has(ctx.conversationId))
            throw new Error('An image is already being made in this chat. Wait for it to finish.');
          if (this.#running.size >= 4)
            throw new Error('Four pictures are already being made. Wait for one to finish.');
          this.#running.add(ctx.conversationId);
          try {
            const editing = typeof args.source === 'string';
            const models = (await this.#models(ctx.signal)).filter(
              (m) => !editing || m.architecture.input_modalities.includes('image'),
            );
            const preferred = [
              'google/gemini-2.5-flash-image',
              'black-forest-labs/flux.2-pro',
              'openai/gpt-image-1',
            ];
            const model = args.model
              ? models.find((m) => m.id === args.model)
              : (preferred.map((id) => models.find((m) => m.id === id)).find(Boolean) ?? models[0]);
            if (!model)
              throw new Error(
                'That image model is not available for this request. Use image_models to choose an available model.',
              );
            for (const field of ['aspect_ratio', 'background']) {
              if (args[field] === undefined) continue;
              const descriptor = z
                .object({ type: z.string(), values: z.array(z.string()).optional() })
                .safeParse(model.supported_parameters?.[field]);
              if (
                !descriptor.success ||
                (descriptor.data.values && !descriptor.data.values.includes(String(args[field])))
              )
                throw new Error(
                  `This model does not support the requested ${field.replace('_', ' ')}. Choose another model with image_models.`,
                );
            }
            const restricted = await ctx.restricted?.('apps', 'openrouter');
            if (!trustsFully(ctx) || ctx.untrusted?.() || restricted) {
              const answer = await ctx.ask({
                toolName: 'image_generate',
                input: { ...args, model: model.id },
                summary: `${editing ? 'Send the source picture to OpenRouter and edit it' : 'Create a picture with OpenRouter'} using ${model.id}. This is a paid API request.`,
                ...((restricted || ctx.untrusted?.()) && {
                  taint: restricted || ctx.untrusted?.(),
                }),
              });
              if (answer === 'deny') return 'The user declined. No image request was sent.';
            }
            ctx.signal.throwIfAborted();
            let reference: string | undefined;
            if (editing) {
              const bytes = await fileBytes(
                await access(),
                String(args.source),
                ctx.signal,
                10 * 1024 * 1024,
              );
              const type = sniff(bytes, 'source', undefined);
              if (type.kind !== 'image')
                throw new Error('Choose a PNG, JPEG, WebP or GIF source picture.');
              reference = `data:${type.mimeType};base64,${bytes.toString('base64')}`;
            }
            const { bytes, type, usage } = await this.#generate({
              model: model.id,
              prompt: String(args.prompt),
              ...(reference && { reference }),
              ...(args.aspect_ratio !== undefined && { aspect_ratio: String(args.aspect_ratio) }),
              ...(args.background !== undefined && { background: String(args.background) }),
              signal: ctx.signal,
            });
            const extension = type.mimeType === 'image/jpeg' ? 'jpg' : type.mimeType.split('/')[1];
            const attachment = await this.deps.store.save({
              name: `${String(args.name).replace(/\.(?:png|jpe?g|webp|gif)$/i, '')}.${extension}`,
              bytes,
            });
            try {
              await this.deps.store.claim([attachment.id], ctx.conversationId);
            } catch (error) {
              await this.deps.store.discard(attachment.id);
              throw error;
            }
            const image: ToolImage = {
              mimeType: type.mimeType as ToolImage['mimeType'],
              data: bytes.toString('base64'),
            };
            const out: HostToolResult = {
              text: JSON.stringify({
                id: attachment.id,
                name: attachment.name,
                path: (await this.deps.store.get(attachment.id))?.path,
                model: model.id,
                costUsd: usage.costUsd ?? null,
                message: 'The image is shown with a preview and Download. ' + MESSAGE,
              }),
              view: { kind: 'downloads', items: [attachment] },
              images: [image],
            };
            return out;
          } finally {
            this.#running.delete(ctx.conversationId);
          }
        },
      },
    ];
  }
}

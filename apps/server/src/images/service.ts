import { z } from 'zod';
import type { EngineId, ToolProgress, Usage } from '@conch/protocol';

import { sniff } from '../attachments/sniff';
import type { AttachmentStore } from '../attachments/store';
import type { ToolContext } from '../conversations/manager';
import { trustsFully } from '../engines/trust';
import type { FileAccess } from '../engines/host';
import type {
  HostTool,
  HostToolResult,
  Picture,
  PictureMaker,
  ToolImage,
  TurnImage,
} from '../engines/types';
import { fileBytes } from '../files/read';
import { paidPictureAsk } from './ask';
import {
  NotMade,
  Unfit,
  geminiBackend,
  openAiBackend,
  openRouterBackend,
  planBackend,
  type ImageBackend,
  type ImageKeyId,
  type Made,
  type MakeInput,
} from './backends';
import { PictureProgress } from './progress';

export interface ImageDeps {
  key: (id: ImageKeyId, signal: AbortSignal) => Promise<string | undefined>;
  hasKey: (id: ImageKeyId) => Promise<boolean>;
  /**
   * Connected providers that make pictures themselves (Codex on a ChatGPT
   * plan), the default first. Asked before any key.
   */
  makers?: () => Promise<{ engine: EngineId; maker: PictureMaker }[]>;
  overBudget: () => Promise<boolean>;
  /** What a paid picture cost, recorded against the provider that made it. */
  spend: (usage: Usage, provider: EngineId) => Promise<unknown>;
  store: AttachmentStore;
  fetch?: typeof fetch;
  /** Nothing the person has can make pictures: the card to connect a way that can. */
  offer: (ctx: ToolContext) => Promise<string>;
  /** Say quietly what was worked around (another way made the picture). */
  healed?: (message: string) => void;
}

/** The one picture for a face being made at a time (beside one per chat). */
const FACE = ' face';
const KEYS: readonly ImageKeyId[] = ['openai', 'gemini', 'openrouter'];
const RASTER = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;
/** Words for a shape that mean one ratio and nothing else. */
const SHAPE_WORDS: Record<string, (typeof ASPECT_RATIOS)[number]> = {
  square: '1:1',
  landscape: '16:9',
  horizontal: '16:9',
  wide: '16:9',
  widescreen: '16:9',
  portrait: '9:16',
  vertical: '9:16',
  tall: '9:16',
};

/**
 * An aspect ratio written another way, as the option it plainly is: `"16x9"`,
 * `"16/9"`, `"1920x1080"`, `"landscape"`, or a size like `"1536x1024"` when it's
 * within 3% of one. Anything else is left for the strict check to explain.
 */
export function readAspectRatio(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim().toLowerCase();
  if ((ASPECT_RATIOS as readonly string[]).includes(text)) return text;
  const word = SHAPE_WORDS[text.replace(/[\s_-]+/g, '')];
  if (word) return word;
  const sides = /^(\d+(?:\.\d+)?)\s*(?:[:x×/*]|\s+by\s+)\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (!sides) return value;
  const ratio = Number(sides[1]) / Number(sides[2]);
  if (!Number.isFinite(ratio) || ratio <= 0) return value;
  const near = ASPECT_RATIOS.find((option) => {
    const [w, h] = option.split(':').map(Number) as [number, number];
    return Math.abs(ratio / (w / h) - 1) <= 0.03;
  });
  return near ?? value;
}

/** A picture's bytes are a real raster image, or nothing is kept. */
function raster(bytes: Buffer) {
  const type = sniff(bytes, 'image', undefined);
  if (type.kind !== 'image' || !RASTER.includes(type.mimeType))
    throw new Error('The service returned a file that is not a supported raster image.');
  return type.mimeType as TurnImage['mimeType'];
}

export class ImageService {
  readonly #running = new Set<string>();
  constructor(private readonly deps: ImageDeps) {}

  /**
   * Every way to make a picture now, in the order to try them: a plan the
   * person already pays for, then a provider of theirs that bills per
   * picture (Codex on an API key, OpenAI, Gemini), and OpenRouter last.
   */
  async backends(): Promise<ImageBackend[]> {
    const fetcher = this.deps.fetch ?? fetch;
    const makers = await (this.deps.makers?.() ?? Promise.resolve([])).catch(() => []);
    const offers = await Promise.all(
      makers.map(async (m) => ({ ...m, offer: await m.maker.available().catch(() => undefined) })),
    );
    const said = new Set<string>();
    const plans: ImageBackend[] = [];
    for (const { engine, maker, offer } of offers) {
      // Codex and Codex CLI share one ChatGPT sign-in: one way, not two.
      if (!offer || said.has(offer.by)) continue;
      said.add(offer.by);
      plans.push(planBackend(engine, maker, offer));
    }
    const keyed = await Promise.all(
      KEYS.map(async (id) => ((await this.deps.hasKey(id).catch(() => false)) ? id : undefined)),
    );
    const key = (id: ImageKeyId) => (signal: AbortSignal) => this.deps.key(id, signal);
    const built = keyed.flatMap((id) =>
      id === 'openai'
        ? [openAiBackend(key(id), fetcher)]
        : id === 'gemini'
          ? [geminiBackend(key(id), fetcher)]
          : id === 'openrouter'
            ? [openRouterBackend(key(id), fetcher)]
            : [],
    );
    return [
      ...plans.filter((b) => b.cost === 'included'),
      ...plans.filter((b) => b.cost === 'paid'),
      ...built,
    ];
  }

  /** Whether a picture can be made at all (an agent's face, ADR 0101). */
  async canMake(): Promise<boolean> {
    return (await this.backends().catch(() => [])).length > 0;
  }

  /**
   * A square picture for an agent's face (ADR 0101), asked for by a person on
   * the page, never by the assistant. Over the monthly budget a paid one
   * doesn't go. One at a time; the bytes go back to the page and are kept nowhere.
   */
  async face(
    prompt: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer; mimeType: string; costUsd?: number }> {
    const all = await this.backends();
    if (!all.length)
      throw new Error('Connect a provider that makes pictures in Settings → Providers first.');
    if (this.#running.has(FACE)) throw new Error('A picture is already being made. Wait for it.');
    this.#running.add(FACE);
    try {
      let last: Error | undefined;
      for (const backend of all) {
        if (backend.cost === 'paid' && (await this.deps.overBudget()))
          throw new Error('Your monthly budget has been reached. Review it in Settings first.');
        // A square, or the shape left to a model that has none.
        const prepared = await backend
          .prepare({ prompt, aspect_ratio: '1:1' }, signal)
          .catch((error: unknown) => {
            if (error instanceof Unfit) return backend.prepare({ prompt }, signal);
            throw error;
          })
          .catch((error: unknown) => {
            if (error instanceof Unfit) return undefined;
            throw error;
          });
        if (!prepared) continue;
        try {
          const made = await prepared.run({ prompt, aspect_ratio: '1:1', signal });
          await this.#spend(backend, made);
          return {
            bytes: made.bytes,
            mimeType: raster(made.bytes),
            ...(made.usage?.costUsd !== undefined && { costUsd: made.usage.costUsd }),
          };
        } catch (error) {
          if (!(error instanceof NotMade)) throw error;
          last = error;
        }
      }
      throw last ?? new Error('No image model is available just now. Try again later.');
    } finally {
      this.#running.delete(FACE);
    }
  }

  async #spend(backend: ImageBackend, made: Made) {
    if (backend.cost !== 'paid' || !made.usage) return;
    if (backend.spendAs) await this.deps.spend(made.usage, backend.spendAs).catch(() => undefined);
  }

  tools(ctx: ToolContext, access: () => Promise<FileAccess>): HostTool[] {
    return [
      {
        name: 'image_models',
        effect: 'read',
        row: true,
        description:
          'List the ways this person can make pictures now, in the order image_generate tries them, with each one’s models and settings: their own plan first (no extra charge), then their own API keys, then OpenRouter. Works whichever model answers this chat. Takes no arguments: call it with {}.',
        input: {},
        run: async () => {
          const all = await this.backends();
          const listed = await Promise.all(
            all.map(async (b) => ({
              by: b.by,
              cost: b.cost === 'included' ? 'included in their plan' : 'paid per picture',
              models: await b.models(ctx.signal).catch(() => []),
            })),
          );
          return JSON.stringify(
            listed.length
              ? listed
              : {
                  message:
                    'None of their providers can make pictures yet. image_generate offers a way.',
                },
          );
        },
      },
      {
        name: 'image_generate',
        row: true,
        description:
          'Create or edit one raster image and show it as a preview/download card. prompt is required: the whole description of the picture, in words. Example: {"prompt": "A sunny beach with palm trees and turquoise water, photorealistic", "aspect_ratio": "16:9"}. For editing, also pass source: an image path from this work folder or chat attachments. Uses the person’s own providers first (a ChatGPT plan makes pictures at no extra charge), then their API keys, and offers a paid way only when none can. Leave model out unless the person asked for one (image_models lists them). Never retry a generation automatically after an uncertain failure.',
        input: {
          prompt: z
            .string()
            .trim()
            .min(1)
            .max(12_000)
            .describe('Required. What to draw (or how to change source), in words.'),
          name: z
            .string()
            .min(1)
            .max(200)
            .default('Generated image')
            .describe('A short title for the picture.'),
          model: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe('Only when the person asked for one; image_models lists them.'),
          source: z
            .string()
            .min(1)
            .max(4096)
            .optional()
            .describe('To edit a picture: its path in this work folder or chat attachments.'),
          aspect_ratio: z.enum(ASPECT_RATIOS).optional().describe('The shape. Default 1:1.'),
          background: z.enum(['auto', 'transparent', 'opaque']).optional(),
        },
        // What models call these fields when they guess (ADR 0072): read, and the model told.
        aliases: {
          prompt: [
            'description',
            'image_prompt',
            'image_description',
            'prompt_text',
            'text',
            'query',
            'input',
          ],
          name: ['title', 'filename', 'file_name'],
          // Not `path` or `size`: those may mean where to save it, or pixels the tool can't take.
          source: ['source_image', 'input_image'],
          aspect_ratio: ['aspectRatio', 'aspect', 'ratio'],
        },
        mend: (args) =>
          args['aspect_ratio'] === undefined
            ? args
            : { ...args, aspect_ratio: readAspectRatio(args['aspect_ratio']) },
        run: async (args) => {
          if (ctx.permissionMode === 'plan')
            throw new Error('Leave plan mode before generating an image.');
          const all = await this.backends();
          if (!all.length) return this.deps.offer(ctx);
          const named = typeof args.model === 'string' ? args.model : undefined;
          const candidates = named ? all.filter((b) => b.claims(named)) : all;
          if (!candidates.length)
            throw new Error(
              'That image model is not available for this request. Use image_models to choose an available model.',
            );
          if (this.#running.has(ctx.conversationId))
            throw new Error('An image is already being made in this chat. Wait for it to finish.');
          if (this.#running.size >= 4)
            throw new Error('Four pictures are already being made. Wait for one to finish.');
          this.#running.add(ctx.conversationId);
          try {
            const editing = typeof args.source === 'string';
            let source: Picture | undefined;
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
              source = {
                mimeType: type.mimeType as TurnImage['mimeType'],
                data: bytes.toString('base64'),
              };
            }
            const request = {
              prompt: String(args.prompt),
              ...(source && { source }),
              ...(args.aspect_ratio !== undefined && { aspect_ratio: String(args.aspect_ratio) }),
              ...(args.background !== undefined && {
                background: args.background as MakeInput['background'] & string,
              }),
            };
            const unfit: string[] = [];
            let fellBack: string | undefined;
            for (const [index, backend] of candidates.entries()) {
              if (backend.cost === 'paid' && (await this.deps.overBudget()))
                throw new Error(
                  'Your monthly budget has been reached. Review it in Settings before creating more images.',
                );
              let prepared;
              try {
                prepared = await backend.prepare(
                  { ...request, ...(named && { model: named }) },
                  ctx.signal,
                );
              } catch (error) {
                // This way can't do what's asked (a setting): the next one may, before anything is sent.
                if (error instanceof Unfit && !named) {
                  unfit.push(error.message);
                  continue;
                }
                throw error;
              }
              const restricted = await ctx.restricted?.('apps', backend.spendAs ?? backend.id);
              const caution = restricted || ctx.untrusted?.();
              // A plan the person has anyway costs nothing more: asked only for a reason that
              // holds in every mode. A paid picture is spending: asked unless Full trust.
              if (caution || (backend.cost === 'paid' && !trustsFully(ctx))) {
                const words =
                  backend.cost === 'paid'
                    ? paidPictureAsk({
                        editing,
                        model: { id: prepared.model },
                        service: backend.by,
                        ...(prepared.costUsd !== undefined && { estimateUsd: prepared.costUsd }),
                      })
                    : {
                        title: editing
                          ? `Edit your picture with ${backend.by}`
                          : `Make a picture with ${backend.by}`,
                        summary: editing
                          ? `Edit your picture with ${backend.by} (no extra charge)`
                          : `Make a picture with ${backend.by} (no extra charge)`,
                        detail: editing
                          ? `Your picture and what you asked for go to ${backend.to ?? backend.by}`
                          : `What you asked for goes to ${backend.to ?? backend.by}`,
                      };
                const answer = await ctx.ask({
                  toolName: 'image_generate',
                  input: { ...args, model: prepared.model },
                  ...words,
                  ...(caution && { taint: caution }),
                });
                if (answer === 'deny') return 'The user declined. No image request was sent.';
              }
              ctx.signal.throwIfAborted();
              const made = await this.#make(ctx, backend, prepared.run, {
                ...request,
                signal: ctx.signal,
              }).catch((error: unknown) => {
                // Certainly nothing made (a used-up plan, a refused key): the next way may try.
                if (error instanceof NotMade && !named && index < candidates.length - 1)
                  return error;
                throw error;
              });
              if (made instanceof Error) {
                fellBack ??= made.message;
                continue;
              }
              if (fellBack) this.deps.healed?.(`Made the picture another way. ${fellBack}`);
              return await this.#keep(ctx, backend, prepared.model, String(args.name), made);
            }
            throw new Error(
              unfit[0] ??
                'None of the ways to make pictures can do this request. Use image_models to choose another model.',
            );
          } finally {
            this.#running.delete(ctx.conversationId);
          }
        },
      },
    ];
  }

  /** One request, with its progress in the chat and its rough pictures kept only while it runs. */
  async #make(
    ctx: ToolContext,
    backend: ImageBackend,
    run: (input: MakeInput) => Promise<Made>,
    input: MakeInput,
  ): Promise<Made> {
    const progress = new PictureProgress({
      emit: (p: ToolProgress) => ctx.append({ type: 'tool.progress', ...p }),
      toolName: 'image_generate',
      by: backend.by,
      typicalMs: backend.typicalMs,
    });
    const previews: string[] = [];
    const saving: Promise<unknown>[] = [];
    let over = false;
    progress.queued();
    if (!backend.startsLater) progress.generating();
    try {
      const made = await run({
        ...input,
        onStarted: () => progress.generating(),
        onPartial: (bytes, index, of) => {
          // The step is real at once; the rough picture follows once it's kept.
          if (!over) progress.partial(index, of);
          saving.push(
            (async () => {
              raster(bytes);
              const saved = await this.deps.store.save({ name: 'Picture so far.png', bytes });
              previews.push(saved.id);
              await this.deps.store.claim([saved.id], ctx.conversationId);
              if (!over) progress.partial(index, of, saved.id);
            })().catch(() => undefined),
          );
        },
      });
      over = true;
      progress.finishing();
      return made;
    } finally {
      over = true;
      progress.stop();
      await Promise.allSettled(saving);
      if (previews.length)
        await this.deps.store.forget(ctx.conversationId, previews).catch(() => undefined);
    }
  }

  /** The picture checked, kept with the chat, and shown. */
  async #keep(
    ctx: ToolContext,
    backend: ImageBackend,
    model: string,
    name: string,
    made: Made,
  ): Promise<HostToolResult> {
    const mimeType = raster(made.bytes);
    await this.#spend(backend, made);
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const attachment = await this.deps.store.save({
      name: `${name.replace(/\.(?:png|jpe?g|webp|gif)$/i, '')}.${extension}`,
      bytes: made.bytes,
    });
    try {
      await this.deps.store.claim([attachment.id], ctx.conversationId);
    } catch (error) {
      await this.deps.store.discard(attachment.id);
      throw error;
    }
    const image: ToolImage = { mimeType, data: made.bytes.toString('base64') };
    return {
      text: JSON.stringify({
        id: attachment.id,
        name: attachment.name,
        path: (await this.deps.store.get(attachment.id))?.path,
        model,
        by: backend.by,
        costUsd: made.usage?.costUsd ?? null,
        message:
          'The image is shown with a preview and Download. ' +
          'In a chat that came from a chat app (Telegram, WhatsApp…) it is sent there with your reply; to send it to one of their chat apps, use message_user with attachments: [id]. The path is only for editing it here: never paste it into a message. ' +
          (backend.cost === 'included'
            ? `Made with ${backend.by}, at no extra charge.`
            : `Made with ${backend.by} and billed by it separately from the chat model.`),
      }),
      view: { kind: 'downloads', items: [attachment] },
      images: [image],
    };
  }
}

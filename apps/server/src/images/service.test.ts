import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationEventInput } from '@conch/protocol';
import type { ToolContext } from '../conversations/manager';
import { AttachmentStore } from '../attachments/store';
import { PictureLimit, type PictureMaker } from '../engines/types';
import { ImageService, type ImageDeps } from './service';
import type { ImageKeyId } from './backends';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXe0AAAAASUVORK5CYII=';
const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

/** What answers each image service in these tests: OpenRouter, OpenAI and Gemini. */
function services() {
  return vi.fn<typeof fetch>(async (url) => {
    const at = String(url);
    if (at.startsWith('https://openrouter.ai/'))
      return at.endsWith('/models')
        ? Response.json({
            data: [
              {
                id: 'test/image',
                name: 'Test image',
                architecture: {
                  input_modalities: ['text', 'image'],
                  output_modalities: ['image'],
                },
              },
            ],
          })
        : Response.json({
            data: [{ b64_json: png, media_type: 'image/png' }],
            usage: { cost: 0.03 },
          });
    if (at.startsWith('https://api.openai.com/'))
      return at.endsWith('/models')
        ? Response.json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }] })
        : Response.json({
            data: [{ b64_json: png }],
            usage: { input_tokens: 5, output_tokens: 9 },
          });
    if (at.startsWith('https://generativelanguage.googleapis.com/'))
      return at.includes('/models?')
        ? Response.json({
            models: [
              {
                name: 'models/gemini-2.5-flash-image',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          })
        : Response.json({
            candidates: [
              { content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } },
            ],
          });
    return new Response('unexpected', { status: 500 });
  });
}

/** A provider's own picture tool, like Codex's on a ChatGPT plan. */
function plan(overrides: Partial<PictureMaker> = {}) {
  const make = vi.fn<PictureMaker['make']>(async (request) => {
    request.onStarted?.();
    return { bytes: Buffer.from(png, 'base64') };
  });
  const maker: PictureMaker = {
    available: async () => ({ cost: 'included', by: 'your ChatGPT plan', to: 'OpenAI' }),
    make,
    ...overrides,
  };
  return { maker, make };
}

async function setup(
  overrides: Partial<ImageDeps> = {},
  keys: readonly ImageKeyId[] = ['openrouter'],
) {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-images-'));
  folders.push(cwd);
  const store = new AttachmentStore(join(cwd, 'attachments'));
  const fetcher = services();
  const spend = vi.fn(async () => {}),
    offer = vi.fn(async () => 'Connect card'),
    healed = vi.fn();
  const deps: ImageDeps = {
    key: async (id) => `${id}-test-key`,
    hasKey: async (id) => keys.includes(id),
    overBudget: async () => false,
    spend,
    store,
    fetch: fetcher,
    offer,
    healed,
    ...overrides,
  };
  const service = new ImageService(deps);
  const events: ConversationEventInput[] = [];
  const ask = vi.fn<ToolContext['ask']>(async () => 'allow');
  const ctx: ToolContext = {
    conversationId: 'one',
    engine: {} as never,
    append: (event) => events.push(event),
    permissionMode: 'default',
    ask,
    signal: new AbortController().signal,
  };
  const run = (args: Record<string, unknown>, context = ctx) =>
    service
      .tools(context, async () => ({ cwd }))
      .find((t) => t.name === 'image_generate')
      ?.run({ prompt: 'A blue bird', name: 'Bird', ...args });
  const progress = () => events.filter((e) => e.type === 'tool.progress');
  return { cwd, store, fetcher, spend, offer, healed, ctx, ask, run, events, progress, service };
}

const text = (result: unknown) =>
  JSON.parse((result as { text: string }).text) as Record<string, unknown>;

describe('image creation and editing', () => {
  it('saves a real image and accounts for its cost without exposing the key', async () => {
    const { run, store, fetcher, spend } = await setup();
    const result = await run({});
    expect(result).toMatchObject({
      view: { kind: 'downloads', items: [{ name: 'Bird.png', kind: 'image' }] },
    });
    expect(JSON.stringify(result)).not.toContain('test-key');
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0.03 }), 'openrouter');
    const files = await store.forConversation('one');
    expect(files).toHaveLength(1);
    expect(await store.bytes(files[0]?.id ?? '')).toEqual(Buffer.from(png, 'base64'));
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: 'error',
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer openrouter-test-key' }),
    });
  });
  it('sends a reference only after approval, and never sends it when denied', async () => {
    const { cwd, run, ctx, fetcher } = await setup();
    await writeFile(join(cwd, 'source.png'), Buffer.from(png, 'base64'));
    expect(await run({ source: 'source.png' }, { ...ctx, ask: async () => 'deny' })).toContain(
      'declined',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await run({ source: 'source.png' });
    const body = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)) as {
      input_references: { image_url: { url: string } }[];
    };
    expect(body.input_references[0]?.image_url.url).toBe(`data:image/png;base64,${png}`);
  });
  it('offers setup, blocks plan mode and observes the monthly budget', async () => {
    const absent = await setup({}, []);
    expect(await absent.run({})).toBe('Connect card');
    expect(absent.fetcher).not.toHaveBeenCalled();
    await expect(absent.run({}, { ...absent.ctx, permissionMode: 'plan' })).rejects.toThrow(
      'plan mode',
    );
    const budget = await setup({ overBudget: async () => true });
    await expect(budget.run({})).rejects.toThrow('budget');
    expect(budget.fetcher).not.toHaveBeenCalled();
  });
  it('rejects unknown models, unsupported options and files outside the workspace', async () => {
    const { run, fetcher } = await setup();
    await expect(run({ model: 'unknown' })).rejects.toThrow('not available');
    await expect(run({ background: 'transparent' })).rejects.toThrow('does not support');
    await expect(run({ source: '../private.png' })).rejects.toThrow('work folder');
    expect(fetcher.mock.calls.every((c) => String(c[0]).endsWith('/models'))).toBe(true);
  });
  it('does not retry a failed generation and does not save a disguised non-image', async () => {
    const { run, fetcher, store } = await setup();
    const models = async () =>
      Response.json({
        data: [
          {
            id: 'test/image',
            architecture: { input_modalities: ['text'], output_modalities: ['image'] },
          },
        ],
      });
    fetcher
      .mockImplementationOnce(models)
      .mockImplementationOnce(async () => new Response('no', { status: 429 }));
    await expect(run({})).rejects.toThrow('limit');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await store.forConversation('one')).toEqual([]);
    fetcher.mockImplementationOnce(models).mockImplementationOnce(async () =>
      Response.json({
        data: [
          {
            b64_json: Buffer.from('<script>bad()</script>').toString('base64'),
            media_type: 'image/png',
          },
        ],
      }),
    );
    await expect(run({})).rejects.toThrow('not a supported raster image');
  });
  it('never tries another way after an uncertain failure', async () => {
    const { run, fetcher } = await setup({}, ['openai', 'openrouter']);
    fetcher
      .mockImplementationOnce(async () => Response.json({ data: [{ id: 'gpt-image-1' }] }))
      .mockImplementationOnce(async () => {
        throw new TypeError('socket hang up');
      });
    await expect(run({})).rejects.toThrow('did not finish');
    expect(fetcher.mock.calls.some((c) => String(c[0]).startsWith('https://openrouter.ai/'))).toBe(
      false,
    );
  });
});

describe('which way makes the picture', () => {
  it('uses the person’s own plan first, without asking and without any key', async () => {
    const own = plan();
    const { run, ask, fetcher, spend } = await setup(
      { makers: async () => [{ engine: 'codex-cli', maker: own.maker }] },
      ['openai', 'gemini', 'openrouter'],
    );
    const result = await run({ aspect_ratio: '16:9' });
    expect(text(result)).toMatchObject({ by: 'your ChatGPT plan', model: 'chatgpt' });
    expect(text(result).message).toContain('no extra charge');
    expect(own.make).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'A blue bird', aspectRatio: '16:9' }),
    );
    expect(ask).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(spend).not.toHaveBeenCalled();
  });
  it('counts one ChatGPT sign-in once, however many of its providers are connected', async () => {
    const own = plan();
    const { service } = await setup(
      {
        makers: async () => [
          { engine: 'codex-cli', maker: own.maker },
          { engine: 'codex-agent', maker: own.maker },
        ],
      },
      ['openrouter'],
    );
    expect((await service.backends()).map((b) => b.id)).toEqual(['plan:codex-cli', 'openrouter']);
  });
  it('orders the person’s own keys before OpenRouter: plan, OpenAI, Gemini, OpenRouter', async () => {
    const own = plan();
    const paid = plan({
      available: async () => ({ cost: 'paid', by: 'OpenAI, through Codex', to: 'OpenAI' }),
    });
    const { service } = await setup(
      {
        makers: async () => [
          { engine: 'codex-agent', maker: paid.maker },
          { engine: 'codex-cli', maker: own.maker },
        ],
      },
      ['openrouter', 'gemini', 'openai'],
    );
    expect((await service.backends()).map((b) => b.id)).toEqual([
      'plan:codex-cli',
      'plan:codex-agent',
      'openai',
      'gemini',
      'openrouter',
    ]);
  });
  it('uses an own OpenAI key before OpenRouter, and asks because it is paid', async () => {
    const { run, ask, fetcher, spend } = await setup({}, ['openai', 'openrouter']);
    const result = await run({});
    expect(text(result)).toMatchObject({ by: 'OpenAI', model: 'gpt-image-1' });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('on OpenAI'),
        cost: expect.stringContaining('Paid'),
      }),
    );
    const posted = fetcher.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(String(posted?.[0])).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({
      model: 'gpt-image-1',
      size: '1024x1024',
      stream: true,
      partial_images: 2,
    });
    expect(fetcher.mock.calls.some((c) => String(c[0]).startsWith('https://openrouter.ai/'))).toBe(
      false,
    );
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 9 }), 'openai');
  });
  it('uses a Gemini key when there is no OpenAI one', async () => {
    const { run, fetcher } = await setup({}, ['gemini', 'openrouter']);
    expect(text(await run({ aspect_ratio: '3:4' }))).toMatchObject({
      by: 'Gemini',
      model: 'gemini-2.5-flash-image',
    });
    const posted = fetcher.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(String(posted?.[0])).toContain('/models/gemini-2.5-flash-image:generateContent');
    expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:4' } },
    });
  });
  it('skips a way that cannot do what is asked, before sending anything', async () => {
    const { run, fetcher } = await setup({}, ['gemini', 'openai']);
    // Gemini makes no transparent backgrounds; OpenAI's GPT Image does.
    expect(text(await run({ background: 'transparent' }))).toMatchObject({ by: 'OpenAI' });
    expect(
      fetcher.mock.calls.some(
        (c) => c[1]?.method === 'POST' && String(c[0]).includes('generativelanguage'),
      ),
    ).toBe(false);
  });
  it('a model the person named goes where that model is', async () => {
    const own = plan();
    const { run } = await setup(
      { makers: async () => [{ engine: 'codex-cli', maker: own.maker }] },
      ['openrouter'],
    );
    expect(text(await run({ model: 'test/image' }))).toMatchObject({ by: 'OpenRouter' });
    expect(own.make).not.toHaveBeenCalled();
  });
  it('when the plan’s pictures are used up, makes it the next way and says so quietly', async () => {
    const own = plan({
      make: async () => {
        throw new PictureLimit('Your ChatGPT plan has made all the pictures it can for now.');
      },
    });
    const { run, ask, healed } = await setup(
      { makers: async () => [{ engine: 'codex-cli', maker: own.maker }] },
      ['openai'],
    );
    expect(text(await run({}))).toMatchObject({ by: 'OpenAI' });
    // The paid way still asks.
    expect(ask).toHaveBeenCalledTimes(1);
    expect(healed).toHaveBeenCalledWith(expect.stringContaining('ChatGPT plan has made all'));
  });
  it('asks before using the plan only for a reason that holds in every mode', async () => {
    const own = plan();
    const { run, ask, ctx } = await setup({
      makers: async () => [{ engine: 'codex-cli', maker: own.maker }],
    });
    await run({}, { ...ctx, untrusted: () => 'This chat read a web page.' });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        taint: 'This chat read a web page.',
        title: 'Make a picture with your ChatGPT plan',
        detail: 'What you asked for goes to OpenAI',
      }),
    );
    expect(ask.mock.calls[0]?.[0]).not.toHaveProperty('cost');
  });
  it('a paid way goes without asking in Full trust', async () => {
    const { run, ask, ctx } = await setup({}, ['openai']);
    await run({}, { ...ctx, permissionMode: 'bypassPermissions' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('progress while a picture is made', () => {
  it('goes queued, generating (estimated), finishing, and never backwards', async () => {
    const own = plan();
    const { run, progress } = await setup({
      makers: async () => [{ engine: 'codex-cli', maker: own.maker }],
    });
    await run({});
    const seen = progress();
    expect(seen.map((e) => e.type === 'tool.progress' && e.stage)).toEqual([
      'queued',
      'generating',
      'finishing',
    ]);
    expect(seen[0]).toMatchObject({
      toolName: 'image_generate',
      progress: 0,
      by: 'your ChatGPT plan',
    });
    expect(seen[1]).toMatchObject({ estimated: true });
    expect(seen[2]).toMatchObject({ progress: 0.95 });
    expect(seen[2]).not.toHaveProperty('estimated');
  });
  it('shows OpenAI’s rough pictures as real progress, and lets them go at the end', async () => {
    const { run, progress, fetcher, store } = await setup({}, ['openai']);
    const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    fetcher
      .mockImplementationOnce(async () => Response.json({ data: [{ id: 'gpt-image-1' }] }))
      .mockImplementationOnce(async () => {
        const frames = [
          frame({ type: 'image_generation.partial_image', b64_json: png, partial_image_index: 0 }),
          frame({ type: 'image_generation.partial_image', b64_json: png, partial_image_index: 1 }),
          frame({
            type: 'image_generation.completed',
            b64_json: png,
            usage: { input_tokens: 1, output_tokens: 2 },
          }),
        ];
        // A rough picture every little while, as the service sends them.
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = frames.shift();
            if (!next) return controller.close();
            await new Promise((resolve) => setTimeout(resolve, 40));
            controller.enqueue(new TextEncoder().encode(next));
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      });
    const result = await run({});
    const seen = progress();
    const previews = seen.flatMap((e) => (e.type === 'tool.progress' && e.preview ? [e] : []));
    expect(previews).toHaveLength(2);
    expect(previews.every((e) => !('estimated' in e))).toBe(true);
    const values = seen.map((e) => (e.type === 'tool.progress' ? (e.progress ?? 0) : 0));
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(seen.at(-1)).toMatchObject({ stage: 'finishing' });
    // Only the final picture is kept with the chat; the rough ones are gone.
    const kept = await store.forConversation('one');
    expect(kept.map((a) => a.id)).toEqual([text(result).id]);
    for (const e of previews)
      if (e.type === 'tool.progress') expect(await store.get(e.preview ?? '')).toBeUndefined();
  });
  it('asks OpenAI again without streaming when the model cannot stream', async () => {
    const { run, fetcher } = await setup({}, ['openai']);
    fetcher
      .mockImplementationOnce(async () => Response.json({ data: [{ id: 'gpt-image-1' }] }))
      .mockImplementationOnce(async () => new Response('no streaming', { status: 400 }));
    expect(text(await run({}))).toMatchObject({ by: 'OpenAI' });
    const posts = fetcher.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(JSON.parse(String(posts[1]?.[1]?.body))).not.toHaveProperty('stream');
  });
});

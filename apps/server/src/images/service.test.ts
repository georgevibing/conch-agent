import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { AttachmentStore } from '../attachments/store';
import { ImageService, type ImageDeps } from './service';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXe0AAAAASUVORK5CYII=';
const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup(overrides: Partial<ImageDeps> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-images-'));
  folders.push(cwd);
  const store = new AttachmentStore(join(cwd, 'attachments'));
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/models')
      ? Response.json({
          data: [
            {
              id: 'test/image',
              name: 'Test image',
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
            },
          ],
        })
      : Response.json({
          data: [{ b64_json: png, media_type: 'image/png' }],
          usage: { cost: 0.03 },
        }),
  );
  const spend = vi.fn(async () => {}),
    offer = vi.fn(async () => 'Connect card');
  const deps: ImageDeps = {
    key: async () => 'test-key',
    hasKey: async () => true,
    overBudget: async () => false,
    spend,
    store,
    fetch: fetcher,
    offer,
    ...overrides,
  };
  const service = new ImageService(deps);
  const ctx: ToolContext = {
    conversationId: 'one',
    engine: {} as never,
    append: () => {},
    permissionMode: 'default',
    ask: async () => 'allow',
    signal: new AbortController().signal,
  };
  const run = (args: Record<string, unknown>, context = ctx) =>
    service
      .tools(context, async () => ({ cwd }))
      .find((t) => t.name === 'image_generate')
      ?.run({ prompt: 'A blue bird', name: 'Bird', ...args });
  return { cwd, store, fetcher, spend, offer, ctx, run };
}

describe('image creation and editing', () => {
  it('saves a real image and accounts for its cost without exposing the key', async () => {
    const { run, store, fetcher, spend } = await setup();
    const result = await run({});
    expect(result).toMatchObject({
      view: { kind: 'downloads', items: [{ name: 'Bird.png', kind: 'image' }] },
    });
    expect(JSON.stringify(result)).not.toContain('test-key');
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0.03 }));
    const files = await store.forConversation('one');
    expect(files).toHaveLength(1);
    expect(await store.bytes(files[0]?.id ?? '')).toEqual(Buffer.from(png, 'base64'));
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: 'error',
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
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
    const absent = await setup({ hasKey: async () => false });
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
    fetcher
      .mockImplementationOnce(async () =>
        Response.json({
          data: [
            {
              id: 'test/image',
              architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            },
          ],
        }),
      )
      .mockImplementationOnce(async () => new Response('no', { status: 429 }));
    await expect(run({})).rejects.toThrow('limit');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await store.forConversation('one')).toEqual([]);
    fetcher
      .mockImplementationOnce(async () =>
        Response.json({
          data: [
            {
              id: 'test/image',
              architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            },
          ],
        }),
      )
      .mockImplementationOnce(async () =>
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
});

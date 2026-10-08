import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PictureLimit } from '../types';
import { makeCodexPicture, pictureText } from './pictures';
import type { CodexRpc, RpcMessage } from './rpc';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXe0AAAAASUVORK5CYII=',
  'base64',
);
const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

/** An app server that answers as Codex does, then plays `script` once the turn starts. */
function server(script: (say: (message: RpcMessage) => void) => void) {
  const listeners = new Set<(message: RpcMessage) => void>();
  const say = (message: RpcMessage) => {
    for (const listener of listeners) listener(message);
  };
  const sent: unknown[] = [];
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === 'thread/start') return { thread: { id: 'th' } };
    if (method === 'turn/start') {
      setTimeout(() => script(say), 0);
      return { turn: { id: 'tu' } };
    }
    throw new Error(`unexpected ${method}`);
  });
  const rpc = {
    listen: (listener: (message: RpcMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFailure: () => () => {},
    send: (message: unknown) => sent.push(message),
    request,
  } as unknown as CodexRpc;
  return { rpc, request, sent, say };
}

const item = (method: string, fields: Record<string, unknown>): RpcMessage => ({
  method,
  params: { threadId: 'th', turnId: 'tu', item: { type: 'imageGeneration', id: 'ig', ...fields } },
});
const completed = (status = 'completed'): RpcMessage => ({
  method: 'turn/completed',
  params: { threadId: 'th', turn: { id: 'tu', status } },
});

describe('a picture on the ChatGPT plan', () => {
  it('asks Codex for one picture in a thread of its own, and reads the image it made', async () => {
    const started = vi.fn();
    const { rpc, request } = server((say) => {
      say(item('item/started', { status: 'in_progress', result: '' }));
      say(item('item/completed', { status: 'completed', result: png.toString('base64') }));
      say(completed());
    });
    const made = await makeCodexPicture(
      rpc,
      {
        prompt: 'A fox',
        source: { mimeType: 'image/png', data: png.toString('base64') },
        aspectRatio: '16:9',
        signal: new AbortController().signal,
        onStarted: started,
      },
      '/run',
    );
    expect(made.bytes).toEqual(png);
    expect(started).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({ ephemeral: true, dynamicTools: [] }),
    );
    const turn = request.mock.calls.find((c) => c[0] === 'turn/start')?.[1] as {
      input: { type: string; url?: string; text?: string }[];
    };
    expect(turn.input[0]?.text).toContain('Shape: 16:9');
    expect(turn.input[1]).toEqual({
      type: 'image',
      url: `data:image/png;base64,${png.toString('base64')}`,
    });
  });

  it('reads a picture Codex saved instead, only from the run’s own home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-codex-pic-'));
    folders.push(home);
    await mkdir(join(home, 'generated_images'));
    const saved = join(home, 'generated_images', 'one.png');
    await writeFile(saved, png);
    const ok = server((say) => say(item('item/completed', { result: '', savedPath: saved })));
    expect(
      (await makeCodexPicture(ok.rpc, { prompt: 'x', signal: new AbortController().signal }, home))
        .bytes,
    ).toEqual(png);
    const outside = server((say) => {
      say(item('item/completed', { result: '', savedPath: '/etc/hosts' }));
    });
    await expect(
      makeCodexPicture(outside.rpc, { prompt: 'x', signal: new AbortController().signal }, home),
    ).rejects.toThrow('without a picture');
  });

  it('says the plan is used up as a limit, so another way may try', async () => {
    const { rpc } = server((say) =>
      say(
        item('item/completed', {
          result: '',
          failure: { type: 'usageLimitExceeded', limitId: 'images', resetsAt: 1_900_000_000 },
        }),
      ),
    );
    const failed = makeCodexPicture(
      rpc,
      { prompt: 'x', signal: new AbortController().signal },
      '/',
    );
    await expect(failed).rejects.toBeInstanceOf(PictureLimit);
    await expect(failed).rejects.toMatchObject({ resetsAt: 1_900_000_000_000 });
  });

  it('a turn that ends without a picture is an error the model can act on', async () => {
    const { rpc } = server((say) => say(completed()));
    await expect(
      makeCodexPicture(rpc, { prompt: 'x', signal: new AbortController().signal }, '/'),
    ).rejects.toThrow('didn’t make a picture');
  });

  it('declines anything else Codex asks for', async () => {
    const { rpc, sent } = server((say) => {
      say({ id: 7, method: 'item/commandExecution/requestApproval', params: {} });
      say({ id: 8, method: 'currentTime/read', params: {} });
      say(item('item/completed', { result: png.toString('base64') }));
    });
    await makeCodexPicture(rpc, { prompt: 'x', signal: new AbortController().signal }, '/');
    expect(sent).toContainEqual({ id: 7, result: { decision: 'decline' } });
    expect(sent).toContainEqual(expect.objectContaining({ id: 8, error: expect.anything() }));
  });

  it('says the shape and background in words', () => {
    expect(pictureText({ prompt: 'A cat', background: 'transparent' })).toBe(
      'Make a new picture as described.\nUse a transparent background.\n\nA cat',
    );
  });
});

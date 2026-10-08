/**
 * A picture made with Codex's own image tool (`image_gen`), on the person's
 * ChatGPT plan: no API key, nothing billed per picture. Conch's
 * `image_generate` asks for it before any paid key (`images/service.ts`).
 *
 * It runs as a thread of its own, apart from any chat: no Conch tools, no
 * shell, nothing kept. The tool's answer is the app server's `imageGeneration`
 * item (`codex app-server generate-ts`: `ImageGenerationItem` — `result` in
 * base64, or `savedPath` under the run's `CODEX_HOME/generated_images`, and a
 * `failure` when the plan's allowance is used up). The base64 always comes,
 * saved or not, in one `item/completed` line: a 1024×1024 PNG is 2–4 MB of it,
 * past what a chat's connection reads, so this one reads up to `PICTURE_LINE`.
 */
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, isAbsolute } from 'node:path';

import { PictureLimit, type PictureRequest } from '../types';
import { LineTooLong, redact, type CodexRpc, type RpcMessage } from './rpc';

/** What the picture thread is told: one picture, nothing else. */
export const PICTURE_INSTRUCTIONS =
  'You make one picture. Call your image generation tool exactly once, with the description below ' +
  '(and the attached picture, when there is one, as the picture to change). Do not run commands, ' +
  'do not ask questions, and do not describe the picture afterwards.';

/** The words the picture thread gets for one request. */
export function pictureText(
  request: Pick<PictureRequest, 'prompt' | 'source' | 'aspectRatio' | 'background'>,
) {
  return [
    request.source ? 'Edit the attached picture as described.' : 'Make a new picture as described.',
    request.aspectRatio && `Shape: ${request.aspectRatio} (width:height).`,
    request.background === 'transparent' && 'Use a transparent background.',
    request.background === 'opaque' && 'Use an opaque background.',
    '',
    request.prompt,
  ]
    .filter((line) => line !== false && line !== undefined)
    .join('\n');
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Limit the picture's size as the other image services do (`images/backends.ts`). */
const MAX_BASE64 = 42_000_000;

/**
 * The longest message a picture's connection reads: the picture in base64 and
 * room for the rest of its item. Held only while it's read, once (`Lines`).
 */
export const PICTURE_LINE = MAX_BASE64 + 2_000_000;

/** Why a failed turn made no picture, in words a person and a model can act on. */
function turnFailure(error: Record<string, unknown>): Error {
  const info = error.codexErrorInfo;
  const status =
    info && typeof info === 'object'
      ? Object.values(info)
          .map((v) => object(v).httpStatusCode)
          .find((s) => typeof s === 'number')
      : undefined;
  if (
    ['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(String(info)) ||
    status === 429
  )
    return new PictureLimit('Your ChatGPT plan has made all the pictures it can for now.');
  if (info === 'unauthorized' || status === 401 || status === 403)
    return new Error('Reconnect ChatGPT in Settings → Providers, then ask for the picture again.');
  if (info === 'serverOverloaded' || info === 'internalServerError')
    return new Error('ChatGPT is busy just now and made no picture. Try once more in a minute.');
  const said = typeof error.message === 'string' ? redact(error.message) : '';
  return new Error(
    said
      ? `ChatGPT couldn’t make this picture: ${said}`
      : 'ChatGPT couldn’t make this picture. Check your ChatGPT connection in Settings → Providers.',
  );
}

/** What went wrong with the connection, said for a picture. */
function connectionFailure(error: Error): Error {
  if (error instanceof LineTooLong)
    return new Error(
      'The picture ChatGPT made was larger than Conch can bring back. Nothing was saved; ask for a smaller one.',
    );
  return error;
}

/**
 * One picture from an initialised app server whose run home is `home`. Every
 * request Codex makes of the client is declined: this thread only makes the
 * picture. Resolves with the bytes; throws `PictureLimit` when the plan's
 * pictures are used up, and an error a model can act on otherwise.
 */
export async function makeCodexPicture(
  rpc: CodexRpc,
  request: PictureRequest,
  home: string,
): Promise<{ bytes: Buffer; revisedPrompt?: string }> {
  let threadId = '';
  let turnId = '';
  let settle!: {
    resolve: (value: { bytes: Buffer; revisedPrompt?: string }) => void;
    reject: (error: Error) => void;
  };
  const done = new Promise<{ bytes: Buffer; revisedPrompt?: string }>((resolve, reject) => {
    settle = { resolve, reject };
  });
  void done.catch(() => {});
  let finished = false;
  const finish = (outcome: { bytes: Buffer; revisedPrompt?: string } | Error) => {
    if (finished) return;
    finished = true;
    if (outcome instanceof Error) settle.reject(outcome);
    else settle.resolve(outcome);
  };
  const readItem = async (item: Record<string, unknown>) => {
    const failure = object(item.failure);
    if (failure.type === 'usageLimitExceeded') {
      const resetsAt = typeof failure.resetsAt === 'number' ? failure.resetsAt * 1000 : undefined;
      finish(
        new PictureLimit('Your ChatGPT plan has made all the pictures it can for now.', resetsAt),
      );
      return;
    }
    const revisedPrompt = typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined;
    const result = typeof item.result === 'string' ? item.result : '';
    if (result && result.length <= MAX_BASE64 && /^[A-Za-z0-9+/]*={0,2}$/.test(result)) {
      finish({ bytes: Buffer.from(result, 'base64'), ...(revisedPrompt && { revisedPrompt }) });
      return;
    }
    // Saved instead of sent: read it only from this run's own home.
    const saved = typeof item.savedPath === 'string' ? item.savedPath : '';
    const inside = saved && relative(home, saved);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
      try {
        finish({ bytes: await readFile(saved), ...(revisedPrompt && { revisedPrompt }) });
        return;
      } catch {
        /* Said below. */
      }
    }
    finish(new Error('ChatGPT’s image tool answered without a picture. Nothing was saved.'));
  };
  const onMessage = (message: RpcMessage) => {
    const p = object(message.params);
    if (message.id !== undefined && message.method) {
      // This thread only makes a picture: anything Codex asks for is declined.
      rpc.send(
        message.method.endsWith('/requestApproval')
          ? {
              id: message.id,
              result:
                message.method === 'item/permissions/requestApproval'
                  ? { permissions: {}, scope: 'turn' }
                  : { decision: 'decline' },
            }
          : { id: message.id, error: { code: -32601, message: 'Only the picture is wanted.' } },
      );
      return;
    }
    if (threadId && typeof p.threadId === 'string' && p.threadId !== threadId) return;
    if (turnId && typeof p.turnId === 'string' && p.turnId !== turnId) return;
    const item = object(p.item);
    if (item.type === 'imageGeneration') {
      if (message.method === 'item/started') request.onStarted?.();
      if (message.method === 'item/completed') void readItem(item);
    }
    if (message.method === 'turn/completed') {
      const turn = object(p.turn);
      // The item is read before the turn ends; a turn without one made nothing.
      setTimeout(
        () =>
          finish(
            turn.status === 'completed'
              ? new Error(
                  'ChatGPT didn’t make a picture this time. Nothing was saved; describe it more plainly and try once more.',
                )
              : turnFailure(object(turn.error)),
          ),
        250,
      ).unref();
    }
  };
  const stopListening = rpc.listen(onMessage);
  const stopFailing = rpc.onFailure((error) => finish(connectionFailure(error)));
  const abort = () => {
    if (threadId && turnId)
      try {
        rpc.send({ id: 'interrupt', method: 'turn/interrupt', params: { threadId, turnId } });
      } catch {
        /* Already stopped. */
      }
    finish(new Error('Stopped.'));
  };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    request.signal.throwIfAborted();
    const started = object(
      await rpc.request('thread/start', {
        // Not the run's home: that holds the sign-in.
        cwd: tmpdir(),
        environments: [],
        approvalPolicy: 'untrusted',
        permissions: 'conch',
        developerInstructions: PICTURE_INSTRUCTIONS,
        allowProviderModelFallback: false,
        // Nothing to carry on: the picture is the whole of it.
        ephemeral: true,
        dynamicTools: [],
      }),
    );
    threadId = String(object(started.thread).id ?? '');
    if (!threadId) throw new Error('Codex did not start making the picture.');
    const turn = object(
      await rpc.request('turn/start', {
        threadId,
        environments: [],
        input: [
          { type: 'text', text: pictureText(request) },
          ...(request.source
            ? [
                {
                  type: 'image',
                  url: `data:${request.source.mimeType};base64,${request.source.data}`,
                },
              ]
            : []),
        ],
      }),
    );
    turnId = String(object(turn.turn).id ?? '');
    return await done;
  } finally {
    request.signal.removeEventListener('abort', abort);
    stopListening();
    stopFailing();
  }
}

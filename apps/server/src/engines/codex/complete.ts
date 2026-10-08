/**
 * One short answer from Codex, for the small jobs Conch does around a chat
 * (a story's headline, "Why?" on a step, a chat's title: ADR 0103), on the
 * person's own ChatGPT plan or key.
 *
 * It runs as a thread of its own, apart from any chat, like a picture
 * (`pictures.ts`): no Conch tools, no shell, no files, nothing kept. Every
 * request Codex makes of the client is declined. The answer is the turn's
 * agent message, in words; what it used is the thread's token count, which
 * for a new thread is this one turn's.
 */
import { tmpdir } from 'node:os';

import type { Usage } from '@conch/protocol';

import type { Completion, CompletionInput } from '../types';
import { redact, type CodexRpc, type RpcMessage } from './rpc';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Why the turn gave no answer, in words a person and a model can act on. */
function turnFailure(error: Record<string, unknown>): Error {
  const info = error.codexErrorInfo;
  if (['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(String(info)))
    return new Error('Your ChatGPT plan has reached its limit for now.');
  if (info === 'unauthorized')
    return new Error('Reconnect ChatGPT in Settings → Providers, then ask again.');
  const said = typeof error.message === 'string' ? redact(error.message) : '';
  return new Error(said ? `Codex couldn’t answer: ${said}` : 'Codex couldn’t answer just now.');
}

/**
 * Answer one prompt on an initialised app server. `effort` is the lightest
 * thinking the model offers, when it says.
 */
export async function completeWithCodex(
  rpc: CodexRpc,
  input: CompletionInput,
  options: { effort?: string } = {},
): Promise<Completion> {
  let threadId = '';
  let turnId = '';
  const said = new Map<string, string>();
  let usage: Usage | undefined;
  let settle!: { resolve: (value: Completion) => void; reject: (error: Error) => void };
  const done = new Promise<Completion>((resolve, reject) => {
    settle = { resolve, reject };
  });
  void done.catch(() => {});
  let finished = false;
  const finish = (outcome: Completion | Error) => {
    if (finished) return;
    finished = true;
    if (outcome instanceof Error) settle.reject(outcome);
    else settle.resolve(outcome);
  };
  const onMessage = (message: RpcMessage) => {
    const p = object(message.params);
    if (message.id !== undefined && message.method) {
      // A short answer needs nothing from Conch: anything Codex asks for is declined.
      rpc.send(
        message.method.endsWith('/requestApproval')
          ? {
              id: message.id,
              result:
                message.method === 'item/permissions/requestApproval'
                  ? { permissions: {}, scope: 'turn' }
                  : { decision: 'decline' },
            }
          : { id: message.id, error: { code: -32601, message: 'Only an answer is wanted.' } },
      );
      return;
    }
    if (threadId && typeof p.threadId === 'string' && p.threadId !== threadId) return;
    if (turnId && typeof p.turnId === 'string' && p.turnId !== turnId) return;
    if (message.method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      const id = String(p.itemId ?? '');
      said.set(id, (said.get(id) ?? '') + p.delta);
    }
    const item = object(p.item);
    if (message.method === 'item/completed' && item.type === 'agentMessage') {
      if (typeof item.text === 'string') said.set(String(item.id ?? ''), item.text);
    }
    if (message.method === 'thread/tokenUsage/updated') {
      const total = object(object(p.tokenUsage).total);
      const inputTokens = count(total.inputTokens);
      const outputTokens = count(total.outputTokens);
      const cached = count(total.cachedInputTokens);
      if (inputTokens !== undefined && outputTokens !== undefined)
        usage = { inputTokens, outputTokens, ...(cached && { cachedInputTokens: cached }) };
    }
    if (message.method === 'turn/completed') {
      const turn = object(p.turn);
      if (turn.status !== 'completed') {
        finish(turnFailure(object(turn.error)));
        return;
      }
      const text = [...said.values()].join('\n').trim();
      finish(text ? { text, ...(usage && { usage }) } : new Error('Codex answered with nothing.'));
    }
  };
  const stopListening = rpc.listen(onMessage);
  const stopFailing = rpc.onFailure((error) => finish(error));
  const abort = () => {
    if (threadId && turnId)
      try {
        rpc.send({ id: 'interrupt', method: 'turn/interrupt', params: { threadId, turnId } });
      } catch {
        /* Already stopped. */
      }
    finish(new Error('Stopped.'));
  };
  input.signal.addEventListener('abort', abort, { once: true });
  try {
    input.signal.throwIfAborted();
    const started = object(
      await rpc.request('thread/start', {
        // Not the run's home: that holds the sign-in.
        cwd: tmpdir(),
        environments: [],
        ...(input.model && { model: input.model }),
        approvalPolicy: 'untrusted',
        permissions: 'conch',
        developerInstructions: input.system,
        allowProviderModelFallback: false,
        // Nothing to carry on: the answer is the whole of it.
        ephemeral: true,
        dynamicTools: [],
      }),
    );
    threadId = String(object(started.thread).id ?? '');
    if (!threadId) throw new Error('Codex did not start the answer.');
    const turn = object(
      await rpc.request('turn/start', {
        threadId,
        environments: [],
        input: [{ type: 'text', text: input.prompt }],
        ...(options.effort && { effort: options.effort }),
      }),
    );
    turnId = String(object(turn.turn).id ?? '');
    return await done;
  } finally {
    input.signal.removeEventListener('abort', abort);
    stopListening();
    stopFailing();
  }
}

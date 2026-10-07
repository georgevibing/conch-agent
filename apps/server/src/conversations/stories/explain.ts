/**
 * "Why?" on a step (ADR 0103): a small model reads the chat's log around one
 * tool call (what the person asked, what the assistant said just before, the
 * call and what it found) and says in a few plain sentences why it was done
 * and what it learned. The work goes on meanwhile; the answer is kept, so
 * asking again costs nothing; a chat can't ask more than a few a minute.
 */
import {
  describeTool,
  type ConversationEvent,
  type ExplainStepResult,
  type ToolLabel,
} from '@conch/protocol';

import { NOT_ASKED_WORDS, Recent, type SmallModelDeps } from './ask';
import { EXPLAIN_SYSTEM, explainPrompt, readExplanation } from './prompt';

export const EXPLAIN_TIMEOUT_MS = 15_000;
/** Questions a chat may ask a minute. */
export const EXPLAIN_PER_MINUTE = 6;

export class ExplainError extends Error {
  constructor(
    readonly code: 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export interface StoryExplainerDeps extends SmallModelDeps {
  /** The chat's log; throws `ConversationError('not-found')` for one that isn't there. */
  events(conversationId: string): Promise<readonly ConversationEvent[]>;
  now?: () => number;
  timeoutMs?: number;
  perMinute?: number;
}

/** What the model reads about one step, from the log. Undefined: no such step. */
export function stepContext(events: readonly ConversationEvent[], toolUseId: string) {
  const at = events.findIndex((e) => e.type === 'tool.started' && e.toolUseId === toolUseId);
  const call = events[at];
  if (call?.type !== 'tool.started') return undefined;
  let request = '';
  const said: string[] = [];
  for (let i = at - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === 'user.message') {
      request = e.text;
      break;
    }
    if (e?.type === 'assistant.delta' && e.kind === 'text') said.unshift(e.delta);
  }
  const finished = events.find(
    (e, i) => i > at && e.type === 'tool.finished' && e.toolUseId === toolUseId,
  );
  const done = finished?.type === 'tool.finished' ? finished : undefined;
  let input: string;
  try {
    input = JSON.stringify(call.input ?? {}) ?? '';
  } catch {
    input = '';
  }
  const label: ToolLabel =
    done?.label ??
    call.label ??
    describeTool(call.name, call.input, done && { status: done.status, output: done.output });
  return {
    request,
    // What it said just before the call, not the whole reply so far.
    said: said.join('').slice(-1_200),
    label,
    name: call.name,
    input,
    ...(done?.output !== undefined && { output: done.output }),
    status: done ? done.status : 'still running',
  };
}

export class StoryExplainer {
  #answers = new Recent<string>(500);
  #asked = new Map<string, number[]>();

  constructor(private readonly deps: StoryExplainerDeps) {}

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  async explain(conversationId: string, toolUseId: string): Promise<ExplainStepResult> {
    const events = await this.deps.events(conversationId);
    const context = stepContext(events, toolUseId);
    if (!context) throw new ExplainError('not-found', 'That step isn’t in this chat any more.');
    const key = `${conversationId}\u0000${toolUseId}`;
    const known = this.#answers.get(key);
    if (known) return { answer: known };
    // A few a minute for each chat: Why? is a person's question, not a loop's.
    const since = this.#now - 60_000;
    const recent = (this.#asked.get(conversationId) ?? []).filter((t) => t > since);
    if (recent.length >= (this.deps.perMinute ?? EXPLAIN_PER_MINUTE))
      return { unavailable: NOT_ASKED_WORDS.busy };
    recent.push(this.#now);
    this.#asked.set(conversationId, recent);
    if (this.#asked.size > 1_000) this.#asked.delete(this.#asked.keys().next().value ?? '');

    const small = await this.deps.model(conversationId).catch(() => undefined);
    if (!small) return { unavailable: NOT_ASKED_WORDS.none };
    const allowed = await this.deps
      .allow(small.engine)
      .catch(() => ({ ok: false as const, reason: 'none' as const }));
    if (!allowed.ok) return { unavailable: NOT_ASKED_WORDS[allowed.reason] };
    try {
      const reply = await small.complete({
        system: EXPLAIN_SYSTEM,
        prompt: explainPrompt(context),
        ...(small.model && { model: small.model }),
        maxTokens: 220,
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? EXPLAIN_TIMEOUT_MS),
      });
      if (reply.usage) this.deps.spent(reply.usage, small.engine, small.model);
      const answer = readExplanation(reply.text);
      if (!answer) return { unavailable: NOT_ASKED_WORDS.failed };
      // A step still running may yet learn more: only a finished one's answer is kept.
      if (context.status !== 'still running') this.#answers.set(key, answer);
      return { answer };
    } catch {
      return { unavailable: NOT_ASKED_WORDS.failed };
    }
  }
}

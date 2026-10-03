import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TurnProblem } from '@conch/protocol';

import type { EngineEvent } from '../types';
import { ClaudePlan } from './plan';

const friendlyErrors: Record<string, string> = {
  authentication_failed:
    'Claude Code is signed out or its credentials expired. Sign in again to continue.',
  oauth_org_not_allowed: "Your organisation doesn't allow this account to use Claude Code.",
  account_on_hold: 'Your Anthropic account is on hold.',
  verification_required: 'Your Anthropic account needs verification before it can be used.',
  billing_error: 'There is a billing problem with your Anthropic account.',
  rate_limit: "You've hit your usage limit. Try again a little later.",
  overloaded: 'Claude is overloaded right now. Try again in a moment.',
  model_not_found: "The selected model isn't available for this account.",
  cloud_credential_error: 'Your cloud provider credentials (e.g. AWS or GCP) need refreshing.',
  server_error: 'Claude hit a server error. Try again in a moment.',
  max_output_tokens: 'The reply was too long and got cut off.',
};

/** The problem class of Claude's own error codes: what the chat can offer about it. */
const problems: Record<string, TurnProblem> = {
  authentication_failed: 'signed-out',
  cloud_credential_error: 'signed-out',
  rate_limit: 'limit',
  overloaded: 'unavailable',
  server_error: 'unavailable',
};

export function friendlyError(code: string | undefined): string | undefined {
  return code ? (friendlyErrors[code] ?? `Claude reported an error (${code}).`) : undefined;
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) =>
        part.type === 'text' ? (part.text ?? '') : `[${part.type ?? 'content'}]`,
      )
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content, null, 2);
}

/**
 * Stateful translator from Claude Agent SDK messages to Conch engine events.
 *
 * Text and thinking stream from partial `stream_event`s; tool calls come from
 * the complete `assistant` message (so inputs are whole); tool results come
 * from the following `user` message. Sub-agent traffic is folded away — the
 * user sees the tool call that spawned it, not its inner monologue.
 */
export class Translator {
  #streamed = new Set<string>();
  #current?: string;
  #error?: string;
  #problem?: TurnProblem;
  /** Its own plan (todos or tasks), drawn as Conch's checklist instead of tool rows. */
  #plan = new ClaudePlan();
  #planCalls = new Set<string>();

  translate(msg: SDKMessage): EngineEvent[] {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          return [{ type: 'session', resumeId: msg.session_id, model: msg.model }];
        }
        if (msg.subtype === 'api_retry') {
          const reason = friendlyError(msg.error) ?? 'Claude is having trouble responding.';
          const seconds = Math.max(1, Math.round(msg.retry_delay_ms / 1000));
          return [
            {
              type: 'notice',
              code: 'retry',
              message: `${reason} Retrying in ${seconds}s (attempt ${msg.attempt} of ${msg.max_retries}).`,
            },
          ];
        }
        return [];

      case 'stream_event': {
        if (msg.parent_tool_use_id) return [];
        const event = msg.event;
        if (event.type === 'message_start') {
          this.#current = event.message.id;
          return [];
        }
        if (!this.#current) return [];
        if (event.type === 'content_block_delta') {
          // Hidden reasoning arrives as empty deltas; they carry nothing to show.
          if (event.delta.type === 'text_delta') {
            if (!event.delta.text) return [];
            this.#streamed.add(this.#current);
            return [{ type: 'text', messageId: this.#current, delta: event.delta.text }];
          }
          if (event.delta.type === 'thinking_delta') {
            if (!event.delta.thinking) return [];
            this.#streamed.add(this.#current);
            return [{ type: 'thinking', messageId: this.#current, delta: event.delta.thinking }];
          }
        }
        if (event.type === 'message_stop') {
          const id = this.#current;
          this.#current = undefined;
          return this.#streamed.has(id) ? [{ type: 'message-done', messageId: id }] : [];
        }
        return [];
      }

      case 'assistant': {
        if (msg.parent_tool_use_id) return [];
        const out: EngineEvent[] = [];
        if (msg.error) {
          // The CLI also renders the raw API error as assistant text; show our friendly one instead.
          this.#error = friendlyError(msg.error);
          this.#problem = msg.error ? problems[msg.error] : undefined;
          return out;
        }
        const id = msg.message.id;
        const streamed = this.#streamed.has(id);
        for (const block of msg.message.content) {
          if (block.type === 'text' && !streamed && block.text) {
            out.push({ type: 'text', messageId: id, delta: block.text });
          } else if (block.type === 'tool_use' && this.#plan.owns(block.name)) {
            this.#planCalls.add(block.id);
            const steps = this.#plan.use(block.id, block.name, block.input);
            if (steps) out.push({ type: 'plan', steps });
          } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
            out.push({
              type: 'tool-start',
              toolUseId: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }
        if (!streamed && out.some((e) => e.type === 'text')) {
          this.#streamed.add(id);
          out.push({ type: 'message-done', messageId: id });
        }
        return out;
      }

      case 'user': {
        if (msg.parent_tool_use_id) return [];
        const content = msg.message.content;
        if (!Array.isArray(content)) return [];
        const results = content.filter((block) => block.type === 'tool_result').length;
        return content.flatMap((block): EngineEvent[] => {
          if (block.type === 'tool_result' && this.#planCalls.delete(block.tool_use_id)) {
            const steps = this.#plan.result(
              block.tool_use_id,
              toolOutput(block.content),
              Boolean(block.is_error),
              // The structured result belongs to the message's one tool call.
              results === 1 ? msg.tool_use_result : undefined,
            );
            return steps ? [{ type: 'plan', steps }] : [];
          }
          return block.type === 'tool_result'
            ? [
                {
                  type: 'tool-end',
                  toolUseId: block.tool_use_id,
                  status: block.is_error ? 'error' : 'success',
                  output: toolOutput(block.content).slice(0, 20_000),
                },
              ]
            : [];
        });
      }

      case 'result': {
        const usage = {
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
        };
        if (msg.subtype === 'success' && !msg.is_error) {
          return [{ type: 'done', outcome: 'success', usage }];
        }
        const detail = 'errors' in msg ? msg.errors.join('\n') : undefined;
        return [
          {
            type: 'done',
            outcome: 'error',
            usage,
            error:
              this.#error ??
              (detail || ('result' in msg ? String(msg.result) : 'Something went wrong.')),
            ...(this.#problem && { problem: this.#problem }),
          },
        ];
      }

      default:
        return [];
    }
  }
}

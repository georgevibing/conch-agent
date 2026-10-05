import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { reportedWindow, Translator } from './translate';

const m = (value: unknown) => value as SDKMessage;

describe('Translator', () => {
  it('streams text and thinking, then emits tools and results', () => {
    const t = new Translator();
    const out = [
      m({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5' }),
      m({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'message_start', message: { id: 'msg1' } },
      }),
      m({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'hmm' },
        },
      }),
      m({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi' } },
      }),
      m({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_stop' } }),
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'msg1',
          content: [
            { type: 'text', text: 'Hi' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      }),
      m({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a\nb' }] },
          ],
        },
      }),
      m({
        type: 'result',
        subtype: 'success',
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.01,
        duration_ms: 900,
      }),
    ].flatMap((msg) => t.translate(msg));

    expect(out).toEqual([
      { type: 'session', resumeId: 's1', model: 'claude-opus-5' },
      { type: 'thinking', messageId: 'msg1', delta: 'hmm' },
      { type: 'text', messageId: 'msg1', delta: 'Hi' },
      { type: 'message-done', messageId: 'msg1' },
      { type: 'tool-start', toolUseId: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool-end', toolUseId: 't1', status: 'success', output: 'a\nb' },
      {
        type: 'done',
        outcome: 'success',
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01, durationMs: 900 },
      },
    ]);
  });

  it('says what the turn has used so far, sub-agents and the cache included (ADR 0057)', () => {
    const t = new Translator();
    const usage = (input: number, cached: number, output: number) => ({
      input_tokens: input,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cached,
      output_tokens: output,
    });
    const first = t.translate(
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: 'a', content: [], usage: usage(100, 20_000, 50) },
      }),
    );
    expect(first.at(-1)).toEqual({
      type: 'usage',
      usage: { inputTokens: 20_100, outputTokens: 50, cachedInputTokens: 20_000 },
      // How full the conversation is: that request, read and answered, of Claude's 200k.
      context: { used: 20_150, window: 200_000 },
    });
    // The same request arriving as a second message counts once.
    t.translate(
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: 'a', content: [], usage: usage(100, 20_000, 80) },
      }),
    );
    const inner = t.translate(
      m({
        type: 'assistant',
        parent_tool_use_id: 'task',
        message: { id: 'b', content: [{ type: 'text', text: 'inner' }], usage: usage(1000, 0, 10) },
      }),
    );
    expect(inner).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 21_100, outputTokens: 90, cachedInputTokens: 20_000 },
        // A sub-agent's request is its own conversation: the main one stays as it was.
        context: { used: 20_180, window: 200_000 },
      },
    ]);
    const [done] = t.translate(
      m({
        type: 'result',
        subtype: 'success',
        is_error: false,
        usage: usage(1100, 20_000, 90),
        total_cost_usd: 0.05,
        duration_ms: 10,
      }),
    );
    expect(done).toMatchObject({
      usage: { inputTokens: 21_100, cachedInputTokens: 20_000, outputTokens: 90, costUsd: 0.05 },
    });
  });

  it('learns the model’s own window from its turn, and starts the next turn with it', () => {
    const first = new Translator();
    first.translate(
      m({ type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-9' }),
    );
    first.translate(
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'a',
          content: [],
          usage: { input_tokens: 100_000, cache_read_input_tokens: 0, output_tokens: 500 },
        },
      }),
    );
    const [done] = first.translate(
      m({
        type: 'result',
        subtype: 'success',
        is_error: false,
        usage: { input_tokens: 100_000, output_tokens: 500 },
        modelUsage: { 'claude-opus-9': { inputTokens: 100_000, contextWindow: 1_000_000 } },
        total_cost_usd: 0,
        duration_ms: 10,
      }),
    );
    // A million-token model isn't shown as half full of 200k.
    expect(done).toMatchObject({ context: { used: 100_500, window: 1_000_000 } });

    const next = new Translator();
    next.translate(m({ type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-9' }));
    const [progress] = next.translate(
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: 'b', content: [], usage: { input_tokens: 10, output_tokens: 1 } },
      }),
    );
    expect(progress).toMatchObject({ context: { window: 1_000_000 } });
  });

  it('reads the window of the model that answered, else the one that read the most', () => {
    expect(
      reportedWindow('claude-sonnet-9', {
        'claude-haiku-9': { inputTokens: 900, contextWindow: 200_000 },
        'claude-sonnet-9': { inputTokens: 100, contextWindow: 1_000_000 },
      }),
    ).toBe(1_000_000);
    expect(
      reportedWindow('opus', {
        'claude-haiku-9': { inputTokens: 900, contextWindow: 200_000 },
        'claude-opus-9[1m]': { inputTokens: 90_000, contextWindow: 1_000_000 },
      }),
    ).toBe(1_000_000);
    expect(reportedWindow('x', undefined)).toBeUndefined();
  });

  it('falls back to full assistant text when nothing streamed', () => {
    const out = new Translator().translate(
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { id: 'x', content: [{ type: 'text', text: 'Whole' }] },
      }),
    );
    expect(out).toEqual([
      { type: 'text', messageId: 'x', delta: 'Whole' },
      { type: 'message-done', messageId: 'x' },
    ]);
  });

  it('ignores sub-agent traffic and maps auth failures to friendly errors', () => {
    const t = new Translator();
    expect(
      t.translate(
        m({
          type: 'assistant',
          parent_tool_use_id: 'task',
          message: { id: 'y', content: [{ type: 'text', text: 'inner' }] },
        }),
      ),
    ).toEqual([]);
    t.translate(
      m({
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'authentication_failed',
        message: { id: 'z', content: [] },
      }),
    );
    const [done] = t.translate(
      m({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['401'],
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        duration_ms: 1,
      }),
    );
    expect(done).toMatchObject({
      type: 'done',
      outcome: 'error',
      error: expect.stringContaining('Sign in again'),
    });
  });

  it('turns API retries into notices and hides raw API error text', () => {
    const t = new Translator();
    const [notice] = t.translate(
      m({
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 4000,
        error_status: null,
        error: 'cloud_credential_error',
      }),
    );
    expect(notice).toMatchObject({
      type: 'notice',
      code: 'retry',
      message: expect.stringContaining('attempt 2 of 10'),
    });
    expect(
      t.translate(
        m({
          type: 'assistant',
          parent_tool_use_id: null,
          error: 'cloud_credential_error',
          message: {
            id: 'e',
            content: [{ type: 'text', text: 'API Error: Could not load AWS credentials' }],
          },
        }),
      ),
    ).toEqual([]);
  });

  it('drops the empty deltas of hidden reasoning', () => {
    const t = new Translator();
    const delta = (d: unknown) =>
      m({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: d },
      });
    t.translate(
      m({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'message_start', message: { id: 'msg1' } },
      }),
    );
    expect(t.translate(delta({ type: 'thinking_delta', thinking: '' }))).toEqual([]);
    expect(t.translate(delta({ type: 'text_delta', text: '' }))).toEqual([]);
    expect(t.translate(delta({ type: 'text_delta', text: 'Hi' }))).toEqual([
      { type: 'text', messageId: 'msg1', delta: 'Hi' },
    ]);
  });
});

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { Translator } from './translate';

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
});

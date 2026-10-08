import { describe, expect, it } from 'vitest';

import { chatOf, logOf, workedChat } from './fixtures';
import {
  ATIF_VERSION,
  toATIF,
  toHtml,
  toMarkdown,
  toOpenAI,
  toShareGPT,
  trajectoryOf,
} from './formats';
import { NoRedaction, Redaction } from './redact';
import { timelineOf } from './timeline';

function trajectory(log = workedChat(), redaction = new NoRedaction()) {
  const chat = chatOf('c1');
  return trajectoryOf(
    { id: chat.id, title: chat.title, agent: 'Pearl', timeline: timelineOf(chat, log) },
    log,
    redaction,
  );
}

describe('a chat as a trajectory', () => {
  it('is messages and calls in order, each call answered', () => {
    const t = trajectory();
    expect(t.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(t.messages[1]).toMatchObject({
      thinking: 'The test expects a 200.',
      text: 'Looking at it now.',
      calls: [{ id: 't1', name: 'Edit' }],
    });
    expect(t.messages.at(-1)).toMatchObject({
      text: 'Fixed: the test passes now.',
      model: 'model-x',
    });
    expect(t.completed).toBe(true);
  });

  it('answers a call that never came back, so the file stays valid', () => {
    const t = trajectory(
      logOf('c1', [
        { type: 'user.message', messageId: 'u1', text: 'Build' },
        { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: { command: 'make' } },
        { type: 'turn.completed', outcome: 'interrupted' },
        { type: 'user.message', messageId: 'u2', text: 'Again' },
      ]),
    );
    expect(t.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(t.messages[2]).toMatchObject({ callId: 't1', failed: true });
    expect(t.completed).toBe(false);
  });

  it('writes OpenAI’s chat format with tool calls', () => {
    const row = toOpenAI(trajectory()) as {
      messages: {
        role: string;
        tool_calls?: { id: string; function: { arguments: string } }[];
        tool_call_id?: string;
      }[];
      tools: { function: { name: string } }[];
      parallel_tool_calls: boolean;
    };
    const call = row.messages[1]?.tool_calls?.[0];
    expect(call?.id).toBe('t1');
    expect(JSON.parse(call?.function.arguments ?? '')).toMatchObject({ file_path: 'src/login.ts' });
    expect(row.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: 'Edited' });
    expect(row.tools.map((t) => t.function.name)).toEqual(['Edit', 'Bash']);
    expect(row.parallel_tool_calls).toBe(false);
  });

  it('writes ShareGPT as Hermes does: human, gpt with <think> and <tool_call>, tool', () => {
    const row = toShareGPT(trajectory()) as {
      conversations: { from: string; value: string }[];
      model: string;
    };
    expect(row.conversations.map((c) => c.from)).toEqual([
      'human',
      'gpt',
      'tool',
      'gpt',
      'tool',
      'gpt',
    ]);
    const gpt = row.conversations[1]?.value ?? '';
    expect(gpt).toMatch(
      /^<think>\nThe test expects a 200.\n<\/think>\nLooking at it now.\n<tool_call>\n/,
    );
    const call = JSON.parse(/<tool_call>\n(.*)\n<\/tool_call>/.exec(gpt)?.[1] ?? '{}');
    expect(call).toEqual({
      name: 'Edit',
      arguments: {
        file_path: 'src/login.ts',
        old_string: 'return 500;',
        new_string: 'return 200;',
      },
    });
    const result = JSON.parse(
      /<tool_response>\n(.*)\n<\/tool_response>/.exec(row.conversations[2]?.value ?? '')?.[1] ??
        '{}',
    );
    expect(result).toEqual({ tool_call_id: 't1', name: 'Edit', content: 'Edited' });
    expect(row.model).toBe('model-x');
  });

  it('writes ATIF: numbered steps, observations matched to calls, tokens and cost', () => {
    const doc = toATIF(trajectory(), '1.2.3') as {
      schema_version: string;
      agent: { name: string; version: string };
      steps: {
        step_id: number;
        source: string;
        tool_calls?: unknown[];
        observation?: { results: { source_call_id: string }[] };
        metrics?: Record<string, number>;
      }[];
      final_metrics: Record<string, number>;
    };
    expect(doc.schema_version).toBe(ATIF_VERSION);
    expect(doc.agent).toMatchObject({ name: 'conch', version: '1.2.3' });
    expect(doc.steps.map((s) => s.step_id)).toEqual([1, 2, 3, 4]);
    expect(doc.steps.map((s) => s.source)).toEqual(['user', 'agent', 'agent', 'agent']);
    expect(doc.steps[1]?.observation?.results[0]?.source_call_id).toBe('t1');
    expect(doc.steps[3]?.metrics).toEqual({
      prompt_tokens: 1200,
      completion_tokens: 300,
      cached_tokens: 800,
      cost_usd: 0.04,
    });
    expect(doc.final_metrics).toMatchObject({
      total_prompt_tokens: 1200,
      total_cost_usd: 0.04,
      total_steps: 4,
    });
  });

  it('takes things out of everything it writes', () => {
    const log = logOf('c1', [
      { type: 'user.message', messageId: 'u1', text: 'Email ada@example.com the report' },
      {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'Bash',
        input: { command: 'cat /Users/ada/.env' },
      },
      {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: 'TOKEN=' + 'ghp_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
      },
      { type: 'turn.completed', outcome: 'success' },
    ]);
    const t = trajectory(log, new Redaction({ home: '/Users/ada' }));
    const all = JSON.stringify([
      toOpenAI(t),
      toShareGPT(t),
      toATIF(t, '1'),
      toMarkdown([t], 'x'),
      toHtml([t], 'x', 'y'),
    ]);
    expect(all).not.toContain('ada@example.com');
    expect(all).not.toContain('/Users/ada');
    expect(all).not.toContain('aBcDeFgHiJkLmNoPq');
  });

  it('draws a page that runs nothing and loads nothing, every word escaped', () => {
    const log = logOf('c1', [
      {
        type: 'user.message',
        messageId: 'u1',
        text: '<script>alert(1)</script><img src=https://evil.example/x>',
      },
      { type: 'turn.completed', outcome: 'success' },
    ]);
    const page = toHtml([trajectory(log)], 'How I did it', 'One chat');
    expect(page).not.toMatch(/<script|<img/i);
    expect(page).toContain('&lt;script&gt;');
    expect(page).toContain("default-src 'none'");
  });

  it('writes Markdown a person reads', () => {
    const md = toMarkdown([trajectory()], 'How I did it');
    expect(md).toMatch(/^# How I did it\n\n## Fix the login test\n/);
    expect(md).toContain('### You');
    expect(md).toContain('```diff\n-return 500;\n+return 200;\n```');
    expect(md).toContain('**Pearl**');
  });
});

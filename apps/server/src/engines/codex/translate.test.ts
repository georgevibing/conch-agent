import { describe, expect, it } from 'vitest';

import type { EngineEvent } from '../types';
import { Translator } from './translate';

/** A turn as `codex exec --json` prints it, plus the junk a real stream carries. */
const TRANSCRIPT = [
  '{"type":"thread.started","thread_id":"01998b0e-7f21-7c9a-8d0e-1f2b3c4d5e6f"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_0","type":"reasoning","text":""}}',
  '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Look at the file first."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":"","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":"README.md\\npackage.json\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.updated","item":{"id":"item_2","type":"todo_list","items":[{"text":"Read the file","completed":true},{"text":"Fix the bug","completed":false}]}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"src/app.ts","kind":"update"}],"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_4","type":"mcp_tool_call","server":"notion","tool":"search","arguments":"{\\"query\\":\\"roadmap\\"}","result":{"content":[{"type":"text","text":"3 results"}]},"error":null,"status":"completed"}}',
  '{"type":"item.started","item":{"id":"item_5","type":"web_search","query":"zod discriminated union","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_5","type":"web_search","query":"zod discriminated union","status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_6","type":"agent_message","text":"Done — I fixed the bug."}}',
  // A release newer than this code: an event and an item we've never seen.
  '{"type":"turn.interrupted_by_aliens","detail":{}}',
  '{"type":"item.completed","item":{"id":"item_7","type":"martian_dance","beats":4}}',
  // A line that isn't JSON at all, and one that got cut in half.
  'codex: thinking…',
  '{"type":"item.completed","item":{"id":"item_8","type":"agent_m',
  '',
  '{"type":"turn.completed","usage":{"input_tokens":12000,"cached_input_tokens":9000,"cache_write_input_tokens":1000,"output_tokens":350,"reasoning_output_tokens":200}}',
];

function translateAll(lines: string[]): EngineEvent[] {
  const translator = new Translator();
  return lines.flatMap((line) => translator.translate(line));
}

describe('Codex translator', () => {
  it('turns a recorded turn into Conch events and ignores what it doesn’t know', () => {
    expect(translateAll(TRANSCRIPT)).toEqual([
      { type: 'session', resumeId: '01998b0e-7f21-7c9a-8d0e-1f2b3c4d5e6f' },
      { type: 'thinking', messageId: 'item_0', delta: 'Look at the file first.' },
      { type: 'message-done', messageId: 'item_0' },
      { type: 'tool-start', toolUseId: 'item_1', name: 'Bash', input: { command: 'bash -lc ls' } },
      {
        type: 'tool-end',
        toolUseId: 'item_1',
        status: 'success',
        output: 'README.md\npackage.json\n',
      },
      { type: 'notice', code: 'plan', message: 'Plan: 1 of 2 done' },
      {
        type: 'tool-start',
        toolUseId: 'item_3',
        name: 'Edit',
        input: { changes: [{ path: 'src/app.ts', kind: 'update' }] },
      },
      { type: 'tool-end', toolUseId: 'item_3', status: 'success', output: 'update src/app.ts' },
      {
        type: 'tool-start',
        toolUseId: 'item_4',
        name: 'mcp__notion__search',
        input: { query: 'roadmap' },
      },
      { type: 'tool-end', toolUseId: 'item_4', status: 'success', output: '3 results' },
      {
        type: 'tool-start',
        toolUseId: 'item_5',
        name: 'WebSearch',
        input: { query: 'zod discriminated union' },
      },
      { type: 'tool-end', toolUseId: 'item_5', status: 'success' },
      { type: 'text', messageId: 'item_6', delta: 'Done — I fixed the bug.' },
      { type: 'message-done', messageId: 'item_6' },
      {
        type: 'done',
        outcome: 'success',
        usage: { inputTokens: 12000, outputTokens: 350 },
      },
    ]);
  });

  it('ends a turn exactly once, whatever follows', () => {
    const translator = new Translator();
    expect(
      translator.translate('{"type":"turn.failed","error":{"message":"model overloaded"}}'),
    ).toEqual([{ type: 'done', outcome: 'error', error: 'model overloaded' }]);
    expect(
      translator.translate(
        '{"type":"item.completed","item":{"id":"z","type":"agent_message","text":"hi"}}',
      ),
    ).toEqual([]);
    expect(translator.translate('{"type":"turn.completed","usage":{}}')).toEqual([]);
  });

  it('reports a fatal error and a failure without a message in plain words', () => {
    expect(translateAll(['{"type":"error","message":"stream disconnected"}'])).toEqual([
      { type: 'done', outcome: 'error', error: 'stream disconnected' },
    ]);
    expect(translateAll(['{"type":"turn.failed"}'])).toEqual([
      { type: 'done', outcome: 'error', error: 'Codex couldn’t finish.' },
    ]);
  });

  it('marks a command that failed or was declined', () => {
    const failed = translateAll([
      '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"npm test","aggregated_output":"1 failing","exit_code":1,"status":"completed"}}',
    ]);
    expect(failed.at(-1)).toMatchObject({ type: 'tool-end', status: 'error', output: '1 failing' });

    const declined = translateAll([
      '{"type":"item.completed","item":{"id":"c2","type":"command_execution","command":"rm -rf /","aggregated_output":"","exit_code":null,"status":"declined"}}',
    ]);
    expect(declined.at(-1)).toEqual({
      type: 'tool-end',
      toolUseId: 'c2',
      status: 'error',
      output: 'Codex declined this step.',
    });
  });

  it('shows an MCP call’s error instead of its result', () => {
    const events = translateAll([
      '{"type":"item.completed","item":{"id":"m1","type":"mcp_tool_call","server":"linear","tool":"create_issue","arguments":{"title":"x"},"result":null,"error":{"message":"Unauthorised"},"status":"failed"}}',
    ]);
    expect(events).toEqual([
      {
        type: 'tool-start',
        toolUseId: 'm1',
        name: 'mcp__linear__create_issue',
        input: { title: 'x' },
      },
      { type: 'tool-end', toolUseId: 'm1', status: 'error', output: 'Unauthorised' },
    ]);
  });

  it('turns an item-scoped error into a notice, not the end of the turn', () => {
    expect(
      translateAll([
        '{"type":"item.completed","item":{"id":"e1","type":"error","message":"Couldn’t read a file."}}',
      ]),
    ).toEqual([{ type: 'notice', code: 'error', message: 'Couldn’t read a file.' }]);
  });

  it('keeps Codex’s own config housekeeping out of the chat', () => {
    // Printed on every turn by a config.toml that still works; nothing for the user to do mid-chat.
    expect(
      translateAll([
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`[features].codex_hooks` is deprecated. Use `[features].hooks` instead. (Enable it with `--enable hooks` or `[features].hooks` in config.toml. See https://developers.openai.com/codex/config-basic#feature-flags for details.)"}}',
        '{"type":"turn.started"}',
      ]),
    ).toEqual([{ type: 'session', resumeId: 't1' }]);
  });

  it('mentions the plan only when it changes', () => {
    const plan = (done: boolean) =>
      `{"type":"item.updated","item":{"id":"p","type":"todo_list","items":[{"text":"a","completed":${done}},{"text":"b","completed":false}]}}`;
    expect(translateAll([plan(false), plan(false), plan(true)])).toEqual([
      { type: 'notice', code: 'plan', message: 'Plan: 0 of 2 done' },
      { type: 'notice', code: 'plan', message: 'Plan: 1 of 2 done' },
    ]);
  });

  it('caps a runaway command output', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'big',
        type: 'command_execution',
        command: 'yes',
        aggregated_output: 'y'.repeat(50_000),
        exit_code: 0,
        status: 'completed',
      },
    });
    const end = translateAll([line]).at(-1);
    expect(end?.type).toBe('tool-end');
    expect(end?.type === 'tool-end' && end.output?.length).toBeLessThan(21_000);
    expect(end?.type === 'tool-end' && end.output).toContain('output truncated');
  });
});

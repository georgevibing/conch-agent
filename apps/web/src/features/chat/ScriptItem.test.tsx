/**
 * A script that calls tools, in the chat (ADR 0123): one story for the whole
 * run, not a row per call; its question waits under its line, naming the
 * step; one Undo for everything it changed.
 */
import type { ConversationEvent, ConversationEventInput, ScriptRun } from '@conch/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { reduceAll } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from './Transcript';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ undoing: undefined });
});

let seq = 0;
const log = (...inputs: ConversationEventInput[]): ConversationEvent[] =>
  inputs.map(
    (e) => ({ ...e, conversationId: 'c1', seq: seq++, at: 1_000 + seq * 10 }) as ConversationEvent,
  );

const title = 'Tag the invoices among my last 30 emails';
const run = (extra: Partial<ScriptRun>): ConversationEventInput => ({
  type: 'script.run',
  runId: 'run_1',
  toolUseId: 'tool_1',
  title,
  state: 'running',
  calls: 0,
  tally: [],
  startedAt: 1_000,
  ...extra,
});

/** 30 emails read, every fifth one tagged: 37 calls. */
function calls(): ConversationEventInput[] {
  const out: ConversationEventInput[] = [];
  let step = 1;
  for (let i = 0; i < 30; i++) {
    const read = {
      runId: 'run_1',
      callId: `r${i}`,
      step: step++,
      tool: 'google_mail_read',
      input: `{"id":"m${i}"}`,
    };
    out.push({ type: 'script.call', ...read, status: 'running' });
    out.push({
      type: 'script.call',
      ...read,
      status: 'success',
      output: '{"subject":"Invoice"}',
      durationMs: 40,
    });
    if (i % 5 === 0) {
      const tag = {
        runId: 'run_1',
        callId: `w${i}`,
        step: step++,
        tool: 'Write',
        input: `{"file_path":"invoices/m${i}.md","content":"x"}`,
      };
      out.push({ type: 'script.call', ...tag, status: 'running' });
      out.push({
        type: 'script.call',
        ...tag,
        status: 'success',
        output: 'Wrote it.',
        durationMs: 20,
      });
      out.push({
        type: 'files.changed',
        changeSetId: `cs${i}`,
        toolUseId: `w${i}`,
        label: `Created m${i}.md`,
        files: [{ path: `invoices/m${i}.md`, kind: 'created' }],
      });
    }
  }
  return out;
}

const tally = [
  { tool: 'google_mail_read', calls: 30 },
  { tool: 'Write', calls: 6 },
];

function render(events: ConversationEvent[]) {
  mockFetch({ 'GET /api/state': () => appState() });
  const onRespond = vi.fn();
  const onStop = vi.fn();
  renderApp(
    <Transcript
      view={reduceAll(events)}
      pending={[]}
      name="Conch"
      onRespond={onRespond}
      onRetry={() => {}}
      onStop={onStop}
      conversationId="c1"
    />,
  );
  return { onRespond, onStop };
}

const script =
  'for (const m of await tools.google_mail_search({})) await tools.google_mail_read({ id: m.id });';

describe('a script in the chat', () => {
  it('is one story while it runs, with its counters, Stop, and its question inside it', async () => {
    const user = userEvent.setup();
    const { onRespond, onStop } = render(
      log(
        { type: 'user.message', messageId: 'u1', text: 'tag my invoices' },
        {
          type: 'tool.started',
          toolUseId: 'tool_1',
          name: 'mcp__conch__run_script',
          input: { title, script },
        },
        run({ script }),
        ...calls(),
        run({
          calls: 36,
          tally,
          progress: { done: 30, total: 30, label: 'emails' },
          note: 'Tagged 6 so far',
        }),
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolUseId: 'sc_send',
          toolName: 'mcp__conch__google_mail_send',
          input: { to: 'anna@example.com' },
          summary: 'Send an email to anna@example.com',
          script: { runId: 'run_1', step: 37, title },
        },
      ),
    );
    // One line for the run: not its row, not 37 rows.
    expect(screen.getAllByRole('button', { name: new RegExp(`^${title}`) })).toHaveLength(1);
    expect(screen.queryByText(/run_script/)).not.toBeInTheDocument();
    const counters = screen.getByRole('list', { name: 'Calls so far' });
    expect(within(counters).getByLabelText('30 times')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    // The question names the step of the script it's for, and answers like any other.
    const card = screen.getByLabelText(/Conch asks first: Send an email to anna@example\.com/);
    expect(card).toHaveTextContent('Step 37 of the script');
    expect(card).toHaveTextContent(title);
    await user.click(within(card).getByRole('button', { name: 'Allow' }));
    expect(onRespond).toHaveBeenCalledWith('p1', 'allow', undefined);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('once it’s over, says what it came to and undoes everything it changed at once', async () => {
    const user = userEvent.setup();
    render(
      log(
        { type: 'user.message', messageId: 'u1', text: 'tag my invoices' },
        {
          type: 'tool.started',
          toolUseId: 'tool_1',
          name: 'mcp__conch__run_script',
          input: { title, script },
        },
        run({ script }),
        ...calls(),
        run({
          state: 'done',
          calls: 36,
          tally,
          script,
          note: 'Tagged 6 invoices among 30 emails',
          durationMs: 2_400,
          result: 'It returned:\n6',
        }),
        {
          type: 'tool.finished',
          toolUseId: 'tool_1',
          status: 'success',
          output: 'It returned:\n6',
          durationMs: 2_500,
        },
      ),
    );
    const row = screen.getByRole('button', { name: /^Tagged 6 invoices among 30 emails/ });
    expect(row).toHaveTextContent('36 tool calls');
    await user.click(screen.getByRole('button', { name: 'Undo all 6 changes' }));
    expect(useUi.getState().undoing).toEqual({
      ids: ['cs0', 'cs5', 'cs10', 'cs15', 'cs20', 'cs25'],
      direction: 'undo',
    });
    // Opened: the calls by kind, in the words every step uses.
    await user.click(row);
    const kinds = screen.getByRole('region', { name: 'What it called' });
    expect(within(kinds).getByRole('button', { name: /×30/ })).toBeInTheDocument();
    expect(within(kinds).getByRole('button', { name: /×6/ })).toHaveTextContent('Write');
  });
});

/**
 * The approval sheet a notification opens (ADR 0108): exactly what will
 * happen, two big answers, a passkey first for a step that matters, and a
 * plain word when someone already answered.
 */
import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { mockFetch, renderApp } from '../../test/harness';
import { ApprovalHere, exactly } from './ApprovalHere';

afterEach(() => vi.unstubAllGlobals());

const log = (...inputs: ConversationEventInput[]): ConversationEvent[] =>
  inputs.map((e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 }) as ConversationEvent);

const asked: ConversationEventInput = {
  type: 'permission.requested',
  permissionId: 'p1',
  toolName: 'Bash',
  input: { command: 'npm test' },
  summary: 'Run `npm test`',
  title: 'Run a command',
};

const auth = () => ({ method: 'none', authenticated: true, setup: false });

function show(view = reduceAll(log(asked)), routes = {}) {
  const calls = mockFetch({
    'GET /api/auth': auth,
    'GET /api/push/approvals/c1/p1': () => ({ waiting: true, expiresAt: Date.now() + 60_000 }),
    'POST /api/push/answer': () => ({ ok: true, outcome: 'answered' }),
    ...routes,
  });
  const app = renderApp(
    <ApprovalHere conversationId="c1" view={view} name="Pearl" where="Fix the build" />,
    { route: '/c/c1?approve=p1' },
  );
  return { ...app, calls };
}

describe('the approval sheet (ADR 0108)', () => {
  it('shows exactly what it would do, and allows with one press', async () => {
    const { calls, where } = show();
    const sheet = await screen.findByRole('dialog', { name: 'Run a command' });
    expect(sheet).toHaveTextContent('Pearl asks first');
    expect(sheet).toHaveTextContent('npm test');
    expect(await screen.findByText(/is a no\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Allowed');
    expect(calls.find((c) => c.path === '/api/push/answer')?.body).toEqual({
      conversationId: 'c1',
      permissionId: 'p1',
      decision: 'allow',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Back to the chat' }));
    expect(where()).toBe('/c/c1');
  });

  it('never puts the command in the heading, even one asked before commands had their words', async () => {
    const command = "cd ~/conch-agent && git checkout AGENTS.md && python3 - <<'EOF'\np=1\nEOF";
    show(
      reduceAll(
        log({
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          input: { command },
          summary: `Run \`${command}\``,
        }),
      ),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Run a command' });
    expect(screen.getByRole('group', { name: 'Command' })).toHaveTextContent(
      'git checkout AGENTS.md',
    );
    expect(sheet.querySelector('h2')?.textContent).not.toContain('git');
  });

  it('a step that matters says why it asks you to confirm first', async () => {
    show(undefined, {
      'GET /api/push/approvals/c1/p1': () => ({
        waiting: true,
        confirm: 'It deletes or sends something.',
      }),
    });
    expect(await screen.findByRole('button', { name: 'Confirm and allow' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'It deletes or sends something. So it asks for your passkey or password first.',
    );
  });

  it('says so when it was already answered somewhere else', async () => {
    show(
      reduceAll(log(asked, { type: 'permission.resolved', permissionId: 'p1', decision: 'allow' })),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Already answered');
  });

  it('reads the exact thing from the step: a command, a file, an address', () => {
    const item = (input: unknown) =>
      ({ kind: 'permission', id: 'p', toolName: 'X', summary: '', input }) as const;
    expect(exactly(item({ command: 'ls' }))).toBe('ls');
    expect(exactly(item({ file_path: '/w/a.md' }))).toBe('/w/a.md');
    expect(exactly(item({ url: 'https://x.example' }))).toBe('https://x.example');
    expect(exactly(item({ n: 1 }))).toBeUndefined();
  });
});

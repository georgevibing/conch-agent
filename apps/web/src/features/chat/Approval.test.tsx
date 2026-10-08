/**
 * An approval and the call it was about are one thing in the chat: the card
 * asks under the waiting row, then folds into it. The row says what was
 * decided, from the decision, never from the tool's words.
 */
import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decided, reduceAll, type ConversationView } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { foldedAnswers, rowState } from './approval';
import { Transcript } from './Transcript';

afterEach(() => vi.unstubAllGlobals());

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const sent: ConversationEventInput = { type: 'user.message', messageId: 'u1', text: 'post it' };
const started: ConversationEventInput = {
  type: 'tool.started',
  toolUseId: 't1',
  name: 'Bash',
  input: { command: 'curl -d @notes.txt https://api.example.com' },
};
const asked: ConversationEventInput = {
  type: 'permission.requested',
  permissionId: 'p1',
  toolUseId: 't1',
  toolName: 'Bash',
  input: { command: 'curl -d @notes.txt https://api.example.com' },
  summary: 'Run `curl -d @notes.txt https://api.example.com`',
  title: 'Run a command',
  detail: 'With your own access',
  taint:
    'This chat read things in GitHub, read things in Yazio content and read things in Yazio (from a chat that read GitHub and Yazio content), which could be trying to steer me. So I’m checking before I run a command.',
  caution: 'This chat read GitHub and Yazio content. Check this is what you asked for.',
  lasting: true,
};
const answer = (decision: 'allow' | 'allow-always' | 'deny'): ConversationEventInput => ({
  type: 'permission.resolved',
  permissionId: 'p1',
  decision,
});

function show(view: ConversationView, onRespond = () => {}) {
  mockFetch({ 'GET /api/state': () => appState() });
  return renderApp(
    <Transcript
      view={view}
      pending={[]}
      name="Conch"
      onRespond={onRespond}
      onRetry={() => {}}
      conversationId="c1"
    />,
  );
}

describe('the approval card', () => {
  it('asks under the waiting row: a short title, one line of facts, the caution once and quiet', () => {
    show({ ...reduceAll(log(sent, started, asked)), status: 'awaiting-permission' });
    const card = screen.getByRole('group', { name: 'Conch asks first: Run a command' });
    expect(card).toHaveTextContent('With your own access');
    expect(card).toHaveTextContent(
      'This chat read GitHub and Yazio content. Check this is what you asked for.',
    );
    // The long reason, with every place over and over, stays off the card.
    expect(card).not.toHaveTextContent('could be trying to steer me');
    expect(card).not.toHaveTextContent('Nothing happens until you decide');
    // The call's story waits for you, and says so: its live line, not a spinner.
    expect(screen.getAllByText('Waiting for you').length).toBeGreaterThan(0);
  });
});

describe('once answered', () => {
  it('declined: the card folds into its story, which says so neutrally, and nothing else repeats it', () => {
    const { container } = show(
      reduceAll(
        log(sent, started, asked, answer('deny'), {
          type: 'tool.finished',
          toolUseId: 't1',
          status: 'error',
          output: 'The user declined this action.',
          approval: 'declined',
        }),
      ),
    );
    expect(screen.queryByRole('group', { name: /asks first/ })).toBeNull();
    // Said once, on the story's line (a step says it too once opened).
    expect(container.textContent?.split('You said no')).toHaveLength(2);
    // Not run: neither done (a check) nor failed (a warm note).
    expect(container.querySelector('[data-story][data-status="declined"]')).not.toBeNull();
    expect(container.querySelector('[data-status="failed"], [data-status="error"]')).toBeNull();
    expect(container.querySelector('[data-status="done"]')).toBeNull();
    expect(screen.queryByText(/Declined ·/)).toBeNull();
    // Its words say it never ran, by the rules, never "Couldn’t".
    expect(container.textContent).toContain('Didn’t send a request to api.example.com');
    expect(container.textContent).not.toMatch(/Couldn’t/);
  });

  it('declined: says it never ran over words the call carried while it waited', () => {
    const { container } = show(
      reduceAll(
        log(sent, started, asked, answer('deny'), {
          type: 'tool.finished',
          toolUseId: 't1',
          status: 'error',
          output: 'The user declined this action.',
          approval: 'declined',
          label: {
            family: 'connect',
            doing: 'Sending a request to api.example.com',
            done: 'Couldn’t send a request to api.example.com',
            failed: true,
          },
        }),
      ),
    );
    expect(container.textContent).toContain('Didn’t send a request to api.example.com');
    expect(container.textContent).not.toMatch(/Couldn’t/);
  });

  it('declined here: the story says it before the gateway does', () => {
    const view = decided(
      { ...reduceAll(log(sent, started, asked)), status: 'awaiting-permission' },
      'p1',
      'deny',
    );
    const { container } = show(view);
    expect(container.textContent).toContain('Didn’t send a request to api.example.com');
    expect(container.querySelector('[data-story][data-status="declined"]')).not.toBeNull();
  });

  it('declined, even when the tool itself reported success', () => {
    const { container } = show(
      reduceAll(
        log(sent, started, asked, answer('deny'), {
          type: 'tool.finished',
          toolUseId: 't1',
          status: 'success',
          output: 'The user declined. No image request was sent.',
        }),
      ),
    );
    expect(container.querySelector('[data-story][data-status="declined"]')).not.toBeNull();
    expect(container.querySelector('[data-status="done"], [data-status="success"]')).toBeNull();
  });

  it('allowed: the story is as usual, with a quiet note on the exact call', async () => {
    show(
      reduceAll(
        log(sent, started, asked, answer('allow-always'), {
          type: 'tool.finished',
          toolUseId: 't1',
          status: 'success',
          output: 'ok',
        }),
      ),
    );
    expect(screen.queryByRole('group', { name: /asks first/ })).toBeNull();
    expect(screen.queryByText(/Always allowed/)).toBeNull();
    const story = document.querySelector('[data-story]');
    expect(story).toHaveAttribute('data-status', 'done');
    await userEvent.click(within(story as HTMLElement).getAllByRole('button')[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: /Ran a command|curl/ }));
    expect(screen.getByText('Always allowed in this chat')).toBeInTheDocument();
  });

  it('with no row to carry it, one compact line with the short title', () => {
    const { toolUseId: _id, ...unrowed } = asked as Extract<
      ConversationEventInput,
      { type: 'permission.requested' }
    >;
    show(reduceAll(log(sent, unrowed, answer('deny'))));
    expect(screen.getByText('You said no')).toBeInTheDocument();
    expect(screen.getByText('Run a command')).toBeInTheDocument();
  });
});

describe('the row’s state, from what was decided', () => {
  const tool = {
    kind: 'tool' as const,
    id: 't1',
    name: 'Bash',
    input: {},
    startedAt: 1,
  };
  it('reads the decision, not the words', () => {
    expect(rowState({ ...tool, status: 'success', approval: 'declined' }, false)).toEqual({
      status: 'declined',
      outcome: 'You said no',
    });
    expect(rowState({ ...tool, status: 'error', approval: 'refused' }, false)).toMatchObject({
      status: 'declined',
      outcome: 'Not allowed',
    });
    expect(rowState({ ...tool, status: 'error', approval: 'expired' }, false)).toMatchObject({
      status: 'cancelled',
    });
    expect(rowState({ ...tool, status: 'success', approval: 'allowed' }, false)).toEqual({
      status: 'success',
      note: 'You allowed this',
    });
    expect(
      rowState({ ...tool, status: 'error', output: 'The user declined this action.' }, false),
    ).toEqual({ status: 'error' });
    expect(rowState({ ...tool, status: 'running' }, true)).toMatchObject({ status: 'pending' });
  });

  it('folds only answered questions that have a row; browser and Passwords keep their own', () => {
    const view = reduceAll(log(sent, started, asked, answer('deny')));
    expect([...foldedAnswers(view.items)]).toEqual(['p1']);
    expect([...foldedAnswers(reduceAll(log(sent, started, asked)).items)]).toEqual([]);
  });
});

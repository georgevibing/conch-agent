import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TranscriptItem } from '../../live/reducer';
import { renderApp } from '../../test/harness';
import { PermissionCard } from './TranscriptItems';

const asked = (
  patch: Partial<Extract<TranscriptItem, { kind: 'permission' }>>,
): Extract<TranscriptItem, { kind: 'permission' }> => ({
  kind: 'permission',
  id: 'permission_1',
  toolName: 'Bash',
  summary: 'Run `grep -rn memory docs`',
  input: { command: 'grep -rn memory docs' },
  ...patch,
});

describe('a command’s card (ADR 0028)', () => {
  it('says what it does in a few words, and the exact command under it', () => {
    renderApp(
      <PermissionCard
        item={asked({ title: 'Run grep in conch-agent' })}
        name="Conch"
        onRespond={() => {}}
      />,
    );
    const card = screen.getByRole('group', { name: 'Conch asks first: Run grep in conch-agent' });
    expect(screen.getByRole('group', { name: 'Command' })).toHaveTextContent(
      'grep -rn memory docs',
    );
    expect(card.querySelector('code')).toBeNull();
  });

  it('never puts the command in the heading, even one asked before commands had their words', () => {
    renderApp(<PermissionCard item={asked({})} name="Conch" onRespond={() => {}} />);
    expect(screen.getByRole('group', { name: 'Conch asks first: Run a command' })).toBeVisible();
  });
});

describe('a question asked because of what the chat read', () => {
  it('says why, and offers “Always allow” like any other', async () => {
    const respond = vi.fn();
    renderApp(
      <PermissionCard
        item={asked({
          taint:
            'This chat read github.com, which could be trying to steer me. So I’m checking before I run a command.',
          lasting: true,
        })}
        name="Conch"
        onRespond={respond}
      />,
    );
    expect(screen.getByText(/This chat read github\.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    expect(respond).toHaveBeenCalledExactlyOnceWith('allow-always');
  });

  it('says the short caution when there is one, never the long reason beside it', () => {
    renderApp(
      <PermissionCard
        item={asked({
          title: 'Edit your picture with Gemini on OpenRouter',
          cost: 'Paid',
          detail: 'Your picture goes to OpenRouter',
          taint:
            'This chat read things in GitHub and read things in Yazio content and 8 more, which could be trying to steer me.',
          caution: 'This chat read GitHub and Yazio content. Check this is what you asked for.',
          lasting: true,
        })}
        name="Conch"
        onRespond={() => {}}
      />,
    );
    const card = screen.getByRole('group', {
      name: 'Conch asks first: Edit your picture with Gemini on OpenRouter',
    });
    expect(card).toHaveTextContent('Paid·Your picture goes to OpenRouter');
    expect(card).toHaveTextContent('This chat read GitHub and Yazio content.');
    expect(card).not.toHaveTextContent('steer me');
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveFocus();
  });

  it('is this once when it asks for leaving the sealed box', () => {
    renderApp(
      <PermissionCard
        item={asked({
          taint:
            'This command wants to run outside the sealed box, where it could reach anything on this computer.',
        })}
        name="Conch"
        onRespond={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  });
});

describe('a question from one of Conch’s own tools', () => {
  it('offers “Always allow” when trying an app’s draft', () => {
    renderApp(
      <PermissionCard
        item={asked({
          toolName: 'app_try',
          summary: 'try Yazio’s check_connection, which can reach yzapi.yazio.com',
          input: {},
        })}
        name="Conch"
        onRespond={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeInTheDocument();
  });

  it('is this once when it shows words going to other people', () => {
    renderApp(
      <PermissionCard
        item={asked({
          toolName: 'slack_send_message',
          summary: 'send this to #general in Slack: “hi”',
          input: {},
          once: true,
        })}
        name="Conch"
        onRespond={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
  });
});

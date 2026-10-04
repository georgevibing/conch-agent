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

describe('a question asked because of what the chat read', () => {
  it('says why, and offers “Always allow” like any other', async () => {
    const respond = vi.fn();
    renderApp(
      <PermissionCard
        item={asked({
          taint:
            'This chat read github.com, which could be trying to steer me. So I’m checking before I run a command.',
          afterReading: true,
        })}
        name="Conch"
        onRespond={respond}
      />,
    );
    expect(screen.getByText(/This chat read github\.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    expect(respond).toHaveBeenCalledExactlyOnceWith('allow-always');
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

import type { Agent } from '@conch/protocol';
import { CommandMenu } from '@conch/nacre';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { useMentions } from './useMentions';

afterEach(() => vi.unstubAllGlobals());

const agent = (id: string, name: string, role = ''): Agent => ({
  id,
  name,
  role,
  avatar: { kind: 'preset', id: 'shell' },
  persona: { tone: 'warm', personality: '' },
  instructions: '',
  isDefault: id === 'ag_conch',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
});

/** The composer's part of it: a text box, the list, and the keys. */
function Box() {
  const [draft, setDraft] = useState('');
  const { menu } = useMentions({ draft, setDraft });
  return (
    <div>
      <textarea
        aria-label="Message"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => menu.onKeyDown(e)}
        {...menu.inputProps}
      />
      <CommandMenu {...menu.menuProps} />
    </div>
  );
}

describe('@ in the composer (ADR 0112)', () => {
  it('lists your agents and outside agents, and writes the whole name', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/agents': () => ({
        agents: [agent('ag_conch', 'Sage'), agent('ag_writer', 'Writer', 'Drafts things')],
        defaultId: 'ag_conch',
      }),
      'GET /api/agents/outside': () => ({
        agents: [
          {
            id: 'oa_travel1',
            name: 'Travel Agent',
            description: '',
            card: 'https://x.example/.well-known/agent-card.json',
            endpoint: 'https://x.example/a2a',
            protocol: '1.0',
            skills: [],
            keyed: false,
            private: false,
            addedAt: 1,
          },
        ],
      }),
    });
    renderApp(<Box />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.type(box, 'Ask @');
    expect(await screen.findByRole('option', { name: /Writer/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Travel Agent/ })).toBeVisible();
    await userEvent.type(box, 'tra');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Ask @Travel Agent ');
  });

  it('leaves email addresses and commands alone', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/agents': () => ({
        agents: [agent('ag_conch', 'Sage'), agent('ag_writer', 'Writer')],
        defaultId: 'ag_conch',
      }),
      'GET /api/agents/outside': () => ({ agents: [] }),
    });
    renderApp(<Box />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'mail ana@wri');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

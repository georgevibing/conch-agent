import type { ConversationSummary } from '@conch/protocol';
import { DropdownMenu } from '@conch/nacre';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../test/harness';
import { ChatMenuItems, type ChatMenuActions } from './ChatMenu';

const chat: ConversationSummary = {
  id: 'c1',
  title: 'Deploy',
  preview: '',
  createdAt: 1,
  updatedAt: 1,
  status: 'idle',
  options: {},
  inbound: 'hold',
};

describe('a chat’s menu', () => {
  it('chooses whether the chat takes messages from your other chats (ADR 0134)', async () => {
    const user = userEvent.setup();
    const inbound = vi.fn();
    const actions = {
      rename: vi.fn(),
      pin: vi.fn(),
      fileIn: vi.fn(),
      newFolder: vi.fn(),
      select: vi.fn(),
      archive: vi.fn(),
      quiet: vi.fn(),
      inbound,
      remove: vi.fn(),
    } satisfies ChatMenuActions;
    renderApp(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>Options</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <ChatMenuItems
            parts={DropdownMenu}
            chat={chat}
            folders={[]}
            quiet={false}
            actions={actions}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    await user.click(screen.getByRole('button', { name: 'Options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Messages from other chats' }));
    expect(await screen.findByRole('menuitem', { name: 'Hold them for me' })).toBeInTheDocument();
    const away = screen.getByRole('menuitem', { name: 'Turn them away' });
    away.focus();
    await user.keyboard('{Enter}');
    expect(inbound).toHaveBeenCalledWith('refuse');
  });
});

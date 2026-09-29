import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Message } from './Message';
import { MessageList } from './MessageList';

describe('Message', () => {
  it('labels turns for assistive tech', async () => {
    const { container } = renderNacre(
      <MessageList>
        <Message from="user">Hi</Message>
        <Message from="assistant" timestamp={new Date('2026-09-29T10:42:00Z')}>
          Hello!
        </Message>
        <Message from="system">Session resumed</Message>
      </MessageList>,
    );
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'You said:' })).toHaveTextContent('Hi');
    expect(screen.getByRole('article', { name: 'Claude said:' })).toHaveTextContent('Hello!');
    expect(screen.getByRole('article', { name: 'System notice' })).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-09-29T10:42:00.000Z');
    await expectAccessible(container);
  });

  it('marks streaming turns busy and hides actions until complete', () => {
    const { rerender } = renderNacre(
      <Message from="assistant" status="streaming" actions={<button type="button">Copy</button>}>
        Thinking
      </Message>,
    );
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    rerender(
      <Message from="assistant" actions={<button type="button">Copy</button>}>
        Done
      </Message>,
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('shows errors with retry', async () => {
    const onRetry = vi.fn();
    renderNacre(
      <Message from="assistant" status="error" error="Connection lost" onRetry={onRetry}>
        Partial
      </Message>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('uses a custom author name', () => {
    renderNacre(
      <Message from="assistant" author="Opus">
        Hey
      </Message>,
    );
    expect(screen.getByRole('article', { name: 'Opus said:' })).toBeInTheDocument();
  });
});

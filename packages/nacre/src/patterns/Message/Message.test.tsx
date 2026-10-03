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

  it('draws what belongs to the reply inside it, before its actions', () => {
    renderNacre(
      <Message
        from="assistant"
        attached={<button type="button">Connect Linear</button>}
        actions={<button type="button">Copy</button>}
      >
        I can’t see your issues yet.
      </Message>,
    );
    const reply = screen.getByRole('article', { name: 'Claude said:' });
    const card = screen.getByRole('button', { name: 'Connect Linear' });
    expect(reply).toContainElement(card);
    expect(
      card.compareDocumentPosition(screen.getByRole('button', { name: 'Copy' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('Message hand-offs', () => {
  it('never replays its entrance when it’s allowed one after mounting', () => {
    const { rerender } = renderNacre(
      <Message from="assistant" entrance={false} status="streaming">
        Hello
      </Message>,
    );
    const reply = screen.getByRole('article');
    expect(reply).toHaveAttribute('data-entrance', 'none');
    // The turn ends: the transcript would now allow an entrance. It must not play.
    rerender(
      <Message from="assistant" entrance status="complete">
        Hello
      </Message>,
    );
    expect(screen.getByRole('article')).toBe(reply);
    expect(reply).toHaveAttribute('data-entrance', 'none');
  });

  it('starts its moving mark as far in as the work is', () => {
    const since = Date.now() - 2_000;
    const { container } = renderNacre(
      <Message from="assistant" status="streaming" since={since}>
        …
      </Message>,
    );
    const mark = container.querySelector<HTMLElement>('[data-active]');
    const age = Number.parseInt(mark?.style.getPropertyValue('--nc-mark-age') ?? '', 10);
    expect(age).toBeGreaterThanOrEqual(2_000);
    expect(age).toBeLessThan(3_000);
  });
});

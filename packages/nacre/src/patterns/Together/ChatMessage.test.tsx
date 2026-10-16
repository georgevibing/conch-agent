import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ChatMessageCard, chatMessageStateWords } from './ChatMessage';

describe('ChatMessageCard', () => {
  it('marks what came here as another chat’s words, and opens that chat', async () => {
    const user = userEvent.setup();
    const onOpenChat = vi.fn();
    const { container } = renderNacre(
      <ChatMessageCard
        direction="in"
        chatTitle="Release notes"
        text="Use loginV2."
        state="read"
        onOpenChat={onOpenChat}
      />,
    );
    const card = screen.getByRole('article', {
      name: 'Message from “Release notes”, another of your chats',
    });
    expect(card).toHaveTextContent('another chat, not you');
    expect(card).toHaveTextContent('Use loginV2.');
    await user.click(screen.getByRole('button', { name: '“Release notes”' }));
    expect(onOpenChat).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('a held message passes on or is dismissed by your press, from the keyboard too', async () => {
    const user = userEvent.setup();
    const onPass = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderNacre(
      <ChatMessageCard
        direction="in"
        chatTitle="Deploy"
        text="Push now."
        state="held"
        onPass={onPass}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Held for you')).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Pass it on' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPass).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('lets you choose whether this chat takes messages', async () => {
    const user = userEvent.setup();
    const onInboundChange = vi.fn();
    renderNacre(
      <ChatMessageCard
        direction="in"
        chatTitle="Deploy"
        text="Hi"
        state="read"
        inbound="accept"
        onInboundChange={onInboundChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Messages from other chats' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Turn them away' }));
    expect(onInboundChange).toHaveBeenCalledWith('refuse');
  });

  it('folds long words, and shows them all on a press', async () => {
    const user = userEvent.setup();
    renderNacre(
      <ChatMessageCard direction="out" chatTitle="X" text={'word '.repeat(100)} state="waiting" />,
    );
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });

  it('says where it is in words, for each side', () => {
    expect(chatMessageStateWords('waiting', 'out')).toBe('Not read yet');
    expect(chatMessageStateWords('waiting', 'out', true)).toBe('Starts its next reply');
    expect(chatMessageStateWords('waiting', 'in')).toBe('Read at the next step');
    expect(chatMessageStateWords('held', 'out')).toBe('Held for the person');
    expect(chatMessageStateWords('refused', 'out')).toBe('Not delivered');
  });

  it('names a stop as a stop', () => {
    renderNacre(
      <ChatMessageCard direction="in" kind="stop" chatTitle="Release" text="Clash" state="read" />,
    );
    expect(
      screen.getByRole('article', { name: 'Stopped by “Release”, another of your chats' }),
    ).toBeInTheDocument();
  });
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ReplyChips } from './ReplyChips';

const replies = [
  { text: 'Make it shorter' },
  { text: 'Add Ada to the invite' },
  { text: 'Send it to the team' },
];

describe('ReplyChips', () => {
  it('shows each reply as a button named by exactly the words it sends', async () => {
    const { container } = renderNacre(<ReplyChips replies={replies} onSend={vi.fn()} />);
    const group = screen.getByRole('toolbar', { name: 'Replies to send' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(
      replies.map((r) => r.text),
    );
    await expectAccessible(container);
  });

  it('shows three at most, and nothing when there are none', () => {
    const { rerender } = renderNacre(
      <ReplyChips replies={[...replies, { text: 'A fourth' }]} onSend={vi.fn()} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);
    rerender(<ReplyChips replies={[]} onSend={vi.fn()} />);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('is one tab stop, with arrow keys between the chips', async () => {
    const onSend = vi.fn();
    renderNacre(
      <>
        <ReplyChips replies={replies} onSend={onSend} />
        <button type="button">After</button>
      </>,
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Make it shorter' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Add Ada to the invite' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Send it to the team' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('lights the pressed one, then sends its words once, however often it’s pressed', async () => {
    const onSend = vi.fn();
    renderNacre(<ReplyChips replies={replies} onSend={onSend} />);
    const chip = screen.getByRole('button', { name: 'Add Ada to the invite' });
    await userEvent.click(chip);
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-state', 'sent');
    expect(chip).toHaveAttribute('data-sent');
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(chip);
    await userEvent.click(screen.getByRole('button', { name: 'Make it shorter' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Add Ada to the invite'));
    await new Promise((r) => setTimeout(r, 250));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('sends from the keyboard too', async () => {
    const onSend = vi.fn();
    renderNacre(<ReplyChips replies={replies} onSend={onSend} />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Send it to the team'));
  });

  it('can be shown as already sent, and stays accessible', async () => {
    const onSend = vi.fn();
    const { container } = renderNacre(
      <ReplyChips replies={replies} onSend={onSend} sent="Make it shorter" entrance={false} />,
    );
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-entrance', 'none');
    expect(screen.getByRole('button', { name: 'Make it shorter' })).toHaveAttribute('data-sent');
    await userEvent.click(screen.getByRole('button', { name: 'Make it shorter' }));
    expect(onSend).not.toHaveBeenCalled();
    await expectAccessible(container);
  });
});

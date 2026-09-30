import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { OfflineNotice, RoutedNote, WaitingMessage } from './Offline';

describe('WaitingMessage', () => {
  it('says the message waits and goes by itself, and offers the model on this computer', async () => {
    const onAnswer = vi.fn();
    const { container } = renderNacre(<WaitingMessage local={{ label: 'Ollama', onAnswer }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the internet');
    expect(screen.getByRole('status')).toHaveTextContent('goes by itself');
    await userEvent.click(screen.getByRole('button', { name: 'Answer now with Ollama' }));
    expect(onAnswer).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('counts several messages waiting together, and offers nothing when nothing local is ready', () => {
    renderNacre(<WaitingMessage count={3} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your 3 messages go together');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shrinks to a quiet line once it went', async () => {
    const { container } = renderNacre(<WaitingMessage state="sent" />);
    expect(screen.getByRole('note')).toHaveTextContent('Sent when you were back online');
    expect(screen.queryByRole('status')).toBeNull();
    await expectAccessible(container);
  });
});

describe('OfflineNotice', () => {
  it('says what happens to what you send', async () => {
    const { container, rerender } = renderNacre(<OfflineNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'You’re offline. Messages wait here, and go by themselves when you’re back.',
    );
    await expectAccessible(container);
    rerender(<OfflineNotice local="Ollama" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ollama answers from this computer until you’re back.',
    );
  });

  it('offers one action', async () => {
    const onClick = vi.fn();
    renderNacre(<OfflineNotice action={{ label: 'Answer with Ollama', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Answer with Ollama' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('RoutedNote', () => {
  it('says who answered and why, with a way to change it', async () => {
    const onClick = vi.fn();
    const { container } = renderNacre(
      <RoutedNote reason="limit" action={{ label: 'Change', onClick }}>
        Claude Code reached its limit, so OpenRouter answered.
      </RoutedNote>,
    );
    expect(screen.getByRole('note')).toHaveTextContent('so OpenRouter answered');
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onClick).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});

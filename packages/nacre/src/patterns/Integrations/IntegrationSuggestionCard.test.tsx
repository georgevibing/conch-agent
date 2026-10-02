import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  IntegrationSuggestionCard,
  type IntegrationSuggestionState,
} from './IntegrationSuggestionCard';

const linear = {
  name: 'Linear',
  brand: 'linear',
  color: '#5E6AD2',
  description: 'Find, create and update issues and projects.',
  assistant: 'Ada’s helper',
};

describe('IntegrationSuggestionCard', () => {
  it('offers to connect, with a way out for this chat and for good', async () => {
    const onConnect = vi.fn();
    const onNotNow = vi.fn();
    const onMute = vi.fn();
    const { container } = renderNacre(
      <IntegrationSuggestionCard
        {...linear}
        state="suggested"
        onConnect={onConnect}
        onNotNow={onNotNow}
        onMute={onMute}
      />,
    );
    const card = screen.getByRole('group', { name: 'Linear isn’t connected yet' });
    expect(card).toHaveTextContent(
      'Connect it and Ada’s helper can find, create and update issues and projects.',
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onConnect).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onNotNow).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Don’t suggest Linear' }));
    expect(onMute).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says where it is while signing in, and lets you pick it up again', async () => {
    const onConnect = vi.fn();
    const { container } = renderNacre(
      <IntegrationSuggestionCard {...linear} state="connecting" onConnect={onConnect} />,
    );
    expect(screen.getByRole('group', { name: 'Connecting Linear…' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onConnect).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('settles once connected, and asks again only while that makes sense', async () => {
    const onAskAgain = vi.fn();
    const { container, rerender } = renderNacre(
      <IntegrationSuggestionCard {...linear} state="connected" onAskAgain={onAskAgain} />,
    );
    expect(screen.getByRole('group', { name: 'Linear is connected' })).toHaveTextContent(
      'Ask again and Ada’s helper will use it.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    expect(onAskAgain).toHaveBeenCalledOnce();
    await expectAccessible(container);
    rerender(<IntegrationSuggestionCard {...linear} state="connected" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('group')).toHaveTextContent('Ada’s helper can use it from now on.');
  });

  it('muted is one quiet line whose Undo takes focus', async () => {
    function Card() {
      const [state, setState] = useState<IntegrationSuggestionState>('suggested');
      return (
        <IntegrationSuggestionCard
          {...linear}
          state={state}
          onMute={() => setState('muted')}
          onUnmute={() => setState('suggested')}
        />
      );
    }
    const { container } = renderNacre(<Card />);
    await userEvent.click(screen.getByRole('button', { name: 'Don’t suggest Linear' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ada’s helper won’t suggest Linear again.',
    );
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await expectAccessible(container);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('group', { name: 'Linear isn’t connected yet' })).toBeInTheDocument();
  });

  it('“Not now” hides it from everyone at once, then says when it’s gone', async () => {
    vi.useFakeTimers();
    try {
      const onGone = vi.fn();
      const { container, rerender } = renderNacre(
        <IntegrationSuggestionCard {...linear} state="suggested" onGone={onGone} />,
      );
      rerender(<IntegrationSuggestionCard {...linear} state="dismissed" onGone={onGone} />);
      const shell = container.querySelector('[data-state="dismissed"]');
      expect(shell).toHaveAttribute('aria-hidden', 'true');
      expect(shell).toHaveAttribute('inert');
      expect(screen.queryByRole('group')).toBeNull();
      expect(onGone).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(700));
      expect(onGone).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

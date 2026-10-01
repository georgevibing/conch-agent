import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { TalkMode } from './TalkMode';
import { VoiceButton } from './VoiceButton';

describe('VoiceButton', () => {
  it('says what pressing it does, in each state', async () => {
    const { rerender, container } = renderNacre(<VoiceButton />);
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(<VoiceButton state="listening" level={0.5} />);
    expect(screen.getByRole('button', { name: 'Stop dictation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible(container);
  });
});

describe('TalkMode', () => {
  it('ends with Escape, and the pearl interrupts while it speaks', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onPearl = vi.fn();
    renderNacre(
      <TalkMode
        open
        onOpenChange={onOpenChange}
        state="speaking"
        name="Pearl"
        reply="Three things tomorrow."
        onPearl={onPearl}
        onKeyboard={() => undefined}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Talking with Pearl' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Speaking… tap to interrupt');
    await user.click(screen.getByRole('button', { name: 'Interrupt' }));
    expect(onPearl).toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows a problem in words, and is accessible', async () => {
    const { baseElement } = renderNacre(
      <TalkMode
        open
        onOpenChange={() => undefined}
        state="error"
        problem="No microphone was found."
        onMute={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No microphone was found.');
    await expectAccessible(baseElement);
  });
});

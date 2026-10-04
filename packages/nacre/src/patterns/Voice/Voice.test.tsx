import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ListeningIndicator } from './ListeningIndicator';
import { TalkMode } from './TalkMode';
import { VoiceButton } from './VoiceButton';
import { VoiceLibrary } from './VoiceLibrary';

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

  it('says talking over it interrupts it, when it does', () => {
    renderNacre(
      <TalkMode open onOpenChange={() => undefined} state="speaking" bargeIn reply="Hi." />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Speaking… just talk to interrupt');
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

describe('VoiceLibrary', () => {
  const voices = [
    {
      id: 'piper:a',
      name: 'Lessac',
      language: 'American English',
      bytes: 63_000_000,
      state: 'ready' as const,
    },
    {
      id: 'piper:b',
      name: 'Ryan',
      language: 'American English',
      bytes: 63_000_000,
      state: 'missing' as const,
    },
    {
      id: 'piper:c',
      name: 'Alba',
      language: 'British English',
      bytes: 63_000_000,
      state: 'downloading' as const,
      done: 31_500_000,
      total: 63_000_000,
    },
  ];

  it('gets, pauses, tries and uses voices, and says which is in use in words', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const { container } = renderNacre(
      <VoiceLibrary
        aria-label="Natural voices"
        voices={voices}
        chosen="piper:a"
        onDownload={(id) => calls.push(`get ${id}`)}
        onPause={(id) => calls.push(`pause ${id}`)}
        onChoose={(id) => calls.push(`use ${id}`)}
        onTry={(id) => calls.push(`try ${id}`)}
      />,
    );
    expect(screen.getByText('In use')).toBeInTheDocument();
    // The one in use offers no Use button.
    expect(screen.queryByRole('button', { name: 'Use Lessac' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Get Ryan, 63 MB' }));
    await user.click(screen.getByRole('button', { name: 'Pause Alba' }));
    await user.click(screen.getByRole('button', { name: 'Try Lessac' }));
    expect(calls).toEqual(['get piper:b', 'pause piper:c', 'try piper:a']);
    expect(screen.getByRole('progressbar')).toHaveAccessibleName(/Downloading Alba/);
    await expectAccessible(container);
  });

  it('offers to carry on after a download stopped, saying why', () => {
    renderNacre(
      <VoiceLibrary
        aria-label="Natural voices"
        voices={[
          {
            id: 'piper:b',
            name: 'Ryan',
            language: 'American English',
            bytes: 63_000_000,
            state: 'missing',
            problem: 'Ryan didn’t finish downloading. Try again.',
          },
        ]}
        onDownload={() => undefined}
        onPause={() => undefined}
        onChoose={() => undefined}
        onTry={() => undefined}
      />,
    );
    expect(screen.getByText('Ryan didn’t finish downloading. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Ryan, 63 MB' })).toHaveTextContent('Carry on');
  });
});

describe('ListeningIndicator', () => {
  it('says in words that it’s listening for the phrase, and stops in one press', async () => {
    const onStop = vi.fn();
    const { container } = renderNacre(
      <ListeningIndicator phrase="“Hey Conch”" hearing onStop={onStop} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Listening for “Hey Conch”');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

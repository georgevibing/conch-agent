import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  WelcomeApps,
  WelcomeChoices,
  WelcomeName,
  WelcomeRise,
  WelcomeStage,
  WelcomeStarters,
  WelcomeSteps,
  WelcomeVoice,
} from './Welcome';

const choices = [
  { value: 'writing', label: 'Writing' },
  { value: 'coding', label: 'Coding' },
  { value: 'research', label: 'Research' },
];

describe('Welcome', () => {
  it('says where you are', async () => {
    const { container } = renderNacre(<WelcomeSteps count={4} current={1} />);
    expect(screen.getByRole('list', { name: 'Step 2 of 4' })).toBeInTheDocument();
    expect(container.querySelectorAll('li[data-state="done"]')).toHaveLength(1);
    await expectAccessible(container);
  });

  it('takes a name, typed large, with a name for screen readers', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderNacre(
      <WelcomeStage>
        <WelcomeRise>
          <WelcomeName label="Your name" onChange={onChange} />
        </WelcomeRise>
      </WelcomeStage>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Ada');
    expect(onChange).toHaveBeenCalledTimes(3);
    await expectAccessible(container);
  });

  it('chooses several, by pointer or keys, and takes one back', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container, rerender } = renderNacre(
      <WelcomeChoices label="Interests" choices={choices} value={['coding']} onChange={onChange} />,
    );
    const group = screen.getByRole('group', { name: 'Interests' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coding' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Writing' }));
    expect(onChange).toHaveBeenLastCalledWith(['coding', 'writing']);
    rerender(
      <WelcomeChoices label="Interests" choices={choices} value={['coding']} onChange={onChange} />,
    );
    // Keys: one tab stop, arrows move, Space toggles.
    screen.getByRole('button', { name: 'Writing' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Coding' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith([]);
    await expectAccessible(container);
  });

  it('says a voice out loud, as the assistant', async () => {
    const { container } = renderNacre(
      <WelcomeVoice from="Conch" text="Done. Three files changed." />,
    );
    expect(screen.getByText('Conch')).toBeInTheDocument();
    expect(await screen.findByText(/Three files changed/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens an app from its tile, and says which are connected', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { container } = renderNacre(
      <WelcomeApps
        label="Your apps"
        apps={[
          { id: 'gmail', name: 'Gmail', connected: true },
          { id: 'slack', name: 'Slack' },
        ]}
        onPick={onPick}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Slack' }));
    expect(onPick).toHaveBeenCalledWith('slack');
    expect(screen.getByRole('button', { name: 'Gmail' })).toHaveAccessibleDescription('Connected');
    await expectAccessible(container);
  });

  it('offers somewhere to start, each in the words it sends', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { container } = renderNacre(
      <WelcomeStarters
        label="Something to ask first"
        starters={['Help me plan my week', 'Teach me something new']}
        onPick={onPick}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Help me plan my week' }));
    expect(onPick).toHaveBeenCalledWith('Help me plan my week');
    await expectAccessible(container);
  });
});

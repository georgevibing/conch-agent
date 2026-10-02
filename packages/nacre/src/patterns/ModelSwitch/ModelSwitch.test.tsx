import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ModelSwitchCard, needWords } from './ModelSwitch';

const linear = { name: 'Linear', brand: 'linear' };

describe('ModelSwitchCard', () => {
  it('says the model can’t use the app, and switches with one press', async () => {
    const onSwitch = vi.fn();
    const onAnswerWithout = vi.fn();
    const { container } = renderNacre(
      <ModelSwitchCard
        model="Chat Lite"
        needs={[linear]}
        switchTo={{ label: 'Opus 5.5' }}
        onSwitch={onSwitch}
        onAnswerWithout={onAnswerWithout}
      />,
    );
    const card = screen.getByRole('group', { name: 'Chat Lite can’t use Linear' });
    expect(card).toHaveTextContent('Opus 5.5 can. Switch, and your message goes by itself.');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Opus 5.5' }));
    expect(onSwitch).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Answer without it' }));
    expect(onAnswerWithout).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('names another provider when the model it offers is on one', () => {
    renderNacre(
      <ModelSwitchCard
        model="Gemma3 1B"
        needs={[linear]}
        switchTo={{ label: 'Opus 5.5', provider: 'Claude Code' }}
        onSwitch={() => {}}
      />,
    );
    expect(screen.getByRole('group')).toHaveTextContent('Opus 5.5 on Claude Code can.');
  });

  it('with no model that can, offers the one next step', async () => {
    const onConnect = vi.fn();
    const { container } = renderNacre(
      <ModelSwitchCard model="Gemma3 1B" needs={[linear]} onConnect={onConnect} />,
    );
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    expect(screen.getByRole('group')).toHaveTextContent('None of the models you’ve set up');
    await userEvent.click(screen.getByRole('button', { name: 'Connect a provider' }));
    expect(onConnect).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('holds still while it goes', () => {
    renderNacre(
      <ModelSwitchCard
        model="Chat Lite"
        needs={[linear]}
        switchTo={{ label: 'Opus 5.5' }}
        onSwitch={() => {}}
        onAnswerWithout={() => {}}
        busy
      />,
    );
    expect(screen.getByRole('button', { name: /Answer without/ })).toBeDisabled();
  });

  it('settles to a quiet line once it went', async () => {
    const { container, rerender } = renderNacre(
      <ModelSwitchCard
        model="Chat Lite"
        needs={[linear]}
        switchTo={{ label: 'Opus 5.5' }}
        state="switched"
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Switched to Opus 5.5 to use Linear');
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
    rerender(<ModelSwitchCard model="Chat Lite" needs={[linear]} state="answered" />);
    expect(screen.getByRole('note')).toHaveTextContent('Answered without Linear');
  });

  it('words what it needs the way people say it', () => {
    expect(needWords([linear])).toBe('Linear');
    expect(needWords([linear, { name: 'Notion' }])).toBe('Linear and Notion');
    expect(needWords([linear, { name: 'Notion' }, { name: 'Slack' }])).toBe(
      'Linear, Notion and Slack',
    );
    expect(needWords([{ name: 'Weekly review', kind: 'skill' }])).toBe('the “Weekly review” skill');
  });
});

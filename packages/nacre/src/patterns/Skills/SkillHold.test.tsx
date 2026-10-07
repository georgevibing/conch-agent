import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SkillHold, SkillHoldEnded, type SkillHoldEntry } from './SkillHold';
import { SkillUsed } from './SkillUsed';

const quickSetup: SkillHoldEntry = {
  skillId: 'quick-setup',
  title: 'Quick setup',
  declared: true,
  capabilities: ['commands'],
  words: ['run commands (only `git`)'],
};
const weekly: SkillHoldEntry = {
  skillId: 'weekly',
  title: 'Weekly review',
  declared: false,
  capabilities: ['files', 'web'],
  words: ['change files in your work folder', 'read the web'],
};

describe('SkillHold', () => {
  it('says what the chat is held to, one line each, and nothing when it’s held to nothing', async () => {
    const { container, rerender } = renderNacre(
      <SkillHold holds={[quickSetup, weekly]} onStop={() => {}} />,
    );
    const group = screen.getByRole('group', { name: 'Skills this chat is held to' });
    expect(group).toHaveTextContent('Held to Quick setup’s list');
    expect(group).toHaveTextContent('Held to Weekly review’s list');
    await expectAccessible(container);
    rerender(<SkillHold holds={[]} onStop={() => {}} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('opens the list from its name, by keyboard', async () => {
    const user = userEvent.setup();
    renderNacre(<SkillHold holds={[quickSetup]} />);
    screen.getByRole('button', { name: 'Held to Quick setup’s list. See what it can do' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'This skill can:' })).toHaveTextContent(
      'run commands (only git)',
    );
    // Without onStop there's nothing to press but the list.
    expect(screen.queryByRole('button', { name: /Stop holding/ })).not.toBeInTheDocument();
  });

  it('asks once before it stops, and keeping it changes nothing', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { baseElement } = renderNacre(<SkillHold holds={[quickSetup]} onStop={onStop} />);
    await user.click(
      screen.getByRole('button', { name: 'Stop holding this chat to Quick setup’s list' }),
    );
    const ask = await screen.findByRole('alertdialog', {
      name: 'Stop holding this chat to Quick setup’s list?',
    });
    expect(ask).toHaveTextContent('Its instructions are still in this chat');
    await expectAccessible(baseElement);
    // The safe way out has the focus.
    expect(screen.getByRole('button', { name: 'Keep holding' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onStop).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Stop holding this chat to Quick setup’s list' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Stop holding' }));
    expect(onStop).toHaveBeenCalledWith('quick-setup');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('keeps the question open when stopping fails, to try again', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn().mockRejectedValueOnce(new Error('offline'));
    renderNacre(<SkillHold holds={[quickSetup]} onStop={onStop} asking="quick-setup" />);
    await user.click(await screen.findByRole('button', { name: 'Stop holding' }));
    await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('can’t stop while an answer is being written', () => {
    renderNacre(<SkillHold holds={[quickSetup]} onStop={() => {}} busy />);
    expect(
      screen.getByRole('button', { name: 'Stop holding this chat to Quick setup’s list' }),
    ).toBeDisabled();
  });

  it('opens the question when asked from outside (⌘K)', async () => {
    const onAskingChange = vi.fn();
    renderNacre(
      <SkillHold
        holds={[quickSetup]}
        onStop={() => {}}
        asking="quick-setup"
        onAskingChange={onAskingChange}
      />,
    );
    expect(
      await screen.findByRole('alertdialog', { name: /Quick setup’s list\?/ }),
    ).toBeInTheDocument();
  });
});

describe('in the chat', () => {
  it('says where a carried hold came from, and where you ended one', async () => {
    const { container } = renderNacre(
      <>
        <SkillUsed name="quick-setup" title="Quick setup" by="carried" />
        <SkillUsed name="weekly" title="Weekly review" by="carried" carriedFrom="helper" />
        <SkillHoldEnded title="Quick setup" />
      </>,
    );
    expect(screen.getAllByRole('note')[0]).toHaveTextContent(
      'Held to the Quick setup skill, like the chat it came from',
    );
    expect(screen.getAllByRole('note')[1]).toHaveTextContent(
      'A task used the Weekly review skill, so this chat is held to it too',
    );
    expect(screen.getByText('You stopped holding this chat to Quick setup’s list.')).toBeVisible();
    await expectAccessible(container);
  });
});

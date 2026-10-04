import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from '../../components/Button';
import { SkillOffer } from './SkillOffer';
import { SkillShelf } from './SkillShelf';
import { SkillWriting } from './SkillWriting';

describe('SkillOffer', () => {
  it('is one line with one button, and Not now', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderNacre(
      <SkillOffer steps={14} onSave={onSave} onDismiss={onDismiss} />,
    );
    const offer = screen.getByRole('group', { name: 'Save how this was done as a skill' });
    expect(offer).toHaveTextContent('That took 14 steps, and it worked.');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save how I did this as a skill' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says so when it was learned after reading something from outside', async () => {
    const { container } = renderNacre(
      <SkillOffer
        steps={11}
        untrusted="Learned in a chat that read trains.example."
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole('group')).toHaveTextContent(
      'Learned in a chat that read trains.example. Read the steps before you save it.',
    );
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('SkillShelf', () => {
  it('lists what sat unused, and only offers', async () => {
    const off = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(
      <SkillShelf
        skills={[
          { id: 'a', name: 'release-notes', title: 'Release notes', idle: 'Last used 3 August' },
          { id: 'b', name: 'tidy-downloads', title: 'Tidy downloads', idle: 'Never used' },
        ]}
        actions={
          <>
            <Button size="sm" onClick={off}>
              Turn them off
            </Button>
            <Button size="sm" variant="ghost">
              Keep them
            </Button>
          </>
        }
      />,
    );
    const shelf = screen.getByRole('region', { name: 'You haven’t used these in two months' });
    expect(shelf).toHaveTextContent('one switch brings each back');
    const list = screen.getByRole('list', { name: 'Skills you haven’t used' });
    expect(list).toHaveTextContent('Release notesLast used 3 August');
    expect(list).toHaveTextContent('Tidy downloadsNever used');
    expect(off).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Turn them off' }));
    expect(off).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('speaks of one skill as one', () => {
    renderNacre(
      <SkillShelf skills={[{ id: 'a', name: 'a', title: 'Release notes', idle: 'Never used' }]} />,
    );
    expect(
      screen.getByRole('region', { name: 'You haven’t used this in two months' }),
    ).toHaveTextContent('Turned off, it stays in your list');
  });
});

describe('SkillWriting', () => {
  it('says the steps are on their way, then offers them again or your own words back', async () => {
    const user = userEvent.setup();
    const onAgain = vi.fn();
    const onUndo = vi.fn();
    const { container, rerender } = renderNacre(
      <SkillWriting state="writing" by="Conch" onAgain={onAgain} onUndo={onUndo} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Conch is writing the steps from your words…',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await expectAccessible(container);
    rerender(<SkillWriting state="written" by="Conch" onAgain={onAgain} onUndo={onUndo} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Conch wrote these from your words. Read them, and change anything.',
    );
    await user.click(screen.getByRole('button', { name: 'Write it again' }));
    await user.click(screen.getByRole('button', { name: 'Back to my words' }));
    expect(onAgain).toHaveBeenCalledOnce();
    expect(onUndo).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});

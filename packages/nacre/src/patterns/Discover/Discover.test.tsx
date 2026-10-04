import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { OfferCard } from '../Offer/OfferCard';
import { blocked, categories, clean, ideas, listings, notes, update, worrying } from './fixtures';
import { MarketCategories, MarketIdeas, MarketShelf } from './MarketShelf';
import { MarketSkillPreview } from './MarketSkillPreview';
import { roughly } from './types';

describe('MarketShelf', () => {
  it('a card per skill: what it does, its trust, where it’s from and how many use it', async () => {
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <MarketShelf listings={listings} onOpen={onOpen} title="Popular" />,
    );
    const card = screen.getByRole('article', { name: 'Meeting notes, from ClawHub. Look at it' });
    expect(card).toHaveTextContent('Turns rough meeting notes');
    expect(card).toHaveTextContent('Verified publisher');
    expect(card).toHaveTextContent('ClawHub · Ada Lovelace');
    expect(card).toHaveTextContent('18k people use it');
    expect(screen.getByRole('article', { name: /Web design guidelines/ })).toHaveTextContent(
      'Added',
    );
    expect(screen.getByRole('article', { name: /Brand voice/ })).toHaveTextContent('Update');
    expect(screen.getByRole('article', { name: /Trip planner/ })).toHaveTextContent('Flagged');
    await expectAccessible(container);
  });

  it('opens a skill by keyboard', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderNacre(<MarketShelf listings={listings} onOpen={onOpen} />);
    await user.tab();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Meeting notes, from ClawHub. Look at it' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(notes);
  });

  it('calm when a place can’t be reached, and an empty search offers a way on', async () => {
    const { rerender, container } = renderNacre(
      <MarketShelf listings={listings.slice(0, 1)} onOpen={() => {}} offline />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('These are from before.');
    rerender(
      <MarketShelf
        listings={[]}
        onOpen={() => {}}
        query="pool hours"
        emptyAction={<button type="button">Write it yourself</button>}
      />,
    );
    expect(screen.getByText('Nobody has shared a skill for “pool hours” yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write it yourself' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('MarketIdeas and MarketCategories', () => {
  it('an idea searches; the kinds move with the arrow keys, one at a time', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onChange = vi.fn();
    const { container } = renderNacre(
      <>
        <MarketIdeas ideas={ideas} onPick={onPick} />
        <MarketCategories categories={categories} value="design" onChange={onChange} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Turn notes into slides' }));
    expect(onPick).toHaveBeenCalledWith(ideas[0]);
    const design = screen.getByRole('radio', { name: 'Design' });
    expect(design).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('tabindex', '-1');
    design.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('productivity');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('documents');
    await expectAccessible(container);
  });
});

describe('MarketSkillPreview', () => {
  it('says what it will be able to do, what Conch found, the version and the licence; one button adds it', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onModeChange = vi.fn();
    const { container } = renderNacre(
      <MarketSkillPreview
        listing={notes}
        preview={clean}
        onAdd={onAdd}
        onModeChange={onModeChange}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Meeting notes' })).toBeInTheDocument();
    expect(screen.getByText(/From ClawHub, by/)).toHaveTextContent(
      'Ada Lovelace · 18k people use it',
    );
    expect(screen.getByRole('region', { name: 'What it will be able to do' })).toHaveTextContent(
      'Nothing in it runs',
    );
    expect(screen.getByText(/Pinned to version 1.4.0/)).toBeInTheDocument();
    expect(screen.getByText('MIT-0: free to use and copy.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Only when I ask' }));
    expect(onModeChange).toHaveBeenCalledWith('manual');
    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(onAdd).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('while it reads, and when it couldn’t', async () => {
    const onRetry = vi.fn();
    const { rerender } = renderNacre(<MarketSkillPreview listing={notes} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading every file in it');
    expect(screen.queryByRole('button', { name: 'Add skill' })).not.toBeInTheDocument();
    rerender(
      <MarketSkillPreview
        listing={notes}
        error="Conch couldn’t reach ClawHub."
        onRetry={onRetry}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('a worrying one waits for a tick that says you read what was found', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <MarketSkillPreview listing={worrying.listing} preview={worrying} onAdd={onAdd} />,
    );
    expect(
      screen.getByText('Downloads something from the internet and runs it straight away.'),
    ).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add anyway' });
    expect(add).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: 'I’ve read what Conch found, and I still want it' }),
    );
    await user.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Pinned to commit c0ffee1/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('one its licence rules out has no button, only why', async () => {
    renderNacre(
      <MarketSkillPreview listing={blocked.listing} preview={blocked} onAdd={() => {}} />,
    );
    expect(screen.getByText('Conch won’t add this one')).toBeInTheDocument();
    expect(
      screen.getByText(/only allows using it inside its maker’s own apps/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
  });

  it('an update says first that it asks for more, then each file', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <MarketSkillPreview listing={notes} preview={update} onAdd={() => {}} />,
    );
    expect(screen.getByText('It asks to do more than before')).toBeInTheDocument();
    expect(screen.getByText('Before, it could only read.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'When it fits' })).not.toBeInTheDocument();
    await user.click(screen.getByText('SKILL.md'));
    expect(
      screen.getByText('4. Offer to draft a follow-up email.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('OfferCard for a skill people share', () => {
  it('says where it’s from, opens it to read, and folds to “Added”', async () => {
    const user = userEvent.setup();
    const onTake = vi.fn();
    const props = {
      kind: 'market' as const,
      name: 'Meeting notes',
      description: 'Turns notes into decisions and actions.',
      market: {
        sourceLabel: 'ClawHub',
        publisher: 'Ada',
        trust: 'verified' as const,
        installs: 18_400,
      },
      muteLabel: 'Don’t suggest skills from Discover',
      onTake,
      onMute: () => {},
    };
    const { rerender, container } = renderNacre(<OfferCard {...props} state="suggested" />);
    expect(screen.getByText('A skill for this: “Meeting notes”')).toBeInTheDocument();
    expect(screen.getByText('ClawHub · Ada · 18k people use it')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Look at it Meeting notes' }));
    expect(onTake).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Don’t suggest skills from Discover' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await expectAccessible(container);
    rerender(<OfferCard {...props} state="accepted" />);
    expect(screen.getByRole('status')).toHaveTextContent(/Added Meeting notes\s*·\s*carrying on/);
  });
});

describe('roughly', () => {
  it('a glance, not a count', () => {
    expect([roughly(950), roughly(1_000), roughly(18_400), roughly(212_000)]).toEqual([
      '950',
      '1k',
      '18k',
      '212k',
    ]);
  });
});

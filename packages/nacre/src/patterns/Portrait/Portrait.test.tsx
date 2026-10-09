import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  guessFixtureKind,
  portraitFacts,
  portraitGroups,
  portraitLearned,
  portraitSuggested,
} from './fixtures';
import { FactChip } from './FactChip';
import { Portrait, type PortraitProps } from './Portrait';
import { PortraitTell } from './PortraitTell';

function setup(over: Partial<PortraitProps> = {}) {
  const props: PortraitProps = {
    name: 'George',
    onNameChange: vi.fn(),
    summary: 'SDM at Amazon · Lives in Berlin',
    groups: portraitGroups,
    facts: [...portraitFacts, ...portraitLearned],
    onAdd: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onKeep: vi.fn(),
    onKeepAll: vi.fn(),
    onDismiss: vi.fn(),
    onTell: vi.fn(),
    guessKind: guessFixtureKind,
    ...over,
  };
  return { ...renderNacre(<Portrait {...props} />), props };
}

const group = (title: string) => screen.getByRole('region', { name: title });

describe('Portrait', () => {
  it('shows who you are in rows of chips, what it learned marked in words', async () => {
    const { container } = setup();
    expect(screen.getByRole('textbox', { name: 'What should I call you?' })).toHaveValue('George');
    expect(screen.getByText('SDM at Amazon · Lives in Berlin')).toBeVisible();
    expect(screen.getByText('8 things you told me')).toBeVisible();
    expect(screen.getByText('4 learned from your chats')).toBeVisible();
    expect(
      within(group('People')).getByRole('button', { name: 'Lina, daughter · born 8 June 2025' }),
    ).toBeVisible();
    expect(
      within(group('How you like answers')).getByRole('button', {
        name: 'Prefers metric units, learned from your chats',
      }),
    ).toBeVisible();
    await expectAccessible(container);
  });

  it('opens a chip in place to correct it, saying where it came from; Escape leaves it', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: /^Prefers metric units/ }));
    expect(screen.getByText('Learned from a chat on 3 May')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open the chat' })).toBeVisible();
    const field = screen.getByRole('textbox', { name: 'How you like answers' });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.keyboard('Metric, always{Enter}');
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', text: 'Metric, always' }),
    );
    // Back on the chip it came from.
    expect(screen.getByRole('button', { name: /^Prefers metric units/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Game dev by night' }));
    await user.keyboard('{Escape}');
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Game dev by night' })).toHaveFocus();
  });

  it('folds a removed chip away, then lets it go and keeps the focus in its row', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'Game dev by night' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const chip = screen.getByRole('button', { name: 'Game dev by night' });
    expect(chip).toHaveAttribute('data-leaving');
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith('f7'));
    await waitFor(() =>
      expect(
        within(group('What you’re into')).getByRole('button', { name: 'Add to What you’re into' }),
      ).toHaveFocus(),
    );
  });

  it('adds a fact in place, with its detail for a person', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(within(group('People')).getByRole('button', { name: 'Add to People' }));
    await user.keyboard('Sam');
    await user.click(within(group('People')).getByRole('textbox', { name: 'Who they are to you' }));
    await user.keyboard('brother{Enter}');
    expect(props.onAdd).toHaveBeenCalledWith({ kind: 'person', text: 'Sam', detail: 'brother' });
  });

  it('asks about what it doesn’t know yet, instead of showing blanks', async () => {
    const user = userEvent.setup();
    const { props, container } = setup({ name: '', facts: [], summary: undefined });
    expect(screen.getByText(/Tell me a little about you/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'People' })).toBeNull();
    const ask = screen.getByRole('button', { name: 'Who’s close to you?' });
    await expectAccessible(container);
    await user.click(ask);
    expect(within(group('People')).getByRole('textbox', { name: 'People' })).toHaveFocus();
    await user.keyboard('{Escape}');
    // Let go of, empty: the question again, with the focus on it.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Who’s close to you?' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Where do you live?' }));
    await user.keyboard('Lisbon{Enter}');
    expect(props.onAdd).toHaveBeenCalledWith({ kind: 'home', text: 'Lisbon' });
  });

  it('keeps a long row short until asked, a new fact always in sight', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      kind: 'person',
      text: `Friend ${i + 1}`,
      ...(i === 11 && { arriving: true }),
    }));
    setup({ facts: many });
    const people = group('People');
    expect(within(people).queryByRole('button', { name: 'Friend 9' })).toBeNull();
    expect(within(people).getByRole('button', { name: 'Friend 12' })).toBeVisible();
    await user.click(within(people).getByRole('button', { name: '3 more' }));
    expect(within(people).getByRole('button', { name: 'Friend 9' })).toBeVisible();
  });

  it('offers what it read in your words to keep or dismiss, and says so once', async () => {
    const user = userEvent.setup();
    const { props, container } = setup({ suggested: portraitSuggested });
    expect(screen.getByRole('status')).toHaveTextContent('I read 2 things in your words');
    await user.click(screen.getByRole('button', { name: 'Keep “Indie hacking”' }));
    expect(props.onKeep).toHaveBeenCalledWith('s2');
    await user.click(screen.getByRole('button', { name: 'Dismiss “Antonis and Poly”' }));
    expect(props.onDismiss).toHaveBeenCalledWith('s1');
    await user.click(screen.getByRole('button', { name: 'Keep all' }));
    expect(props.onKeepAll).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('PortraitTell', () => {
  it('shows where the words will go as you type, and turns them into a fact there', async () => {
    const user = userEvent.setup();
    const onTell = vi.fn();
    const { container } = renderNacre(
      <PortraitTell groups={portraitGroups} guess={guessFixtureKind} onTell={onTell} />,
    );
    const field = screen.getByRole('textbox', { name: 'Tell Conch something about you' });
    expect(screen.queryByRole('button', { name: /Goes in/ })).toBeNull();
    await user.type(field, 'I prefer metric units');
    expect(screen.getByRole('button', { name: /Goes in How you like answers/ })).toBeVisible();
    await expectAccessible(container);
    await user.keyboard('{Enter}');
    expect(onTell).toHaveBeenCalledWith('I prefer metric units', 'way');
    expect(field).toHaveValue('');
    expect(screen.getByText('Added to How you like answers.')).toBeVisible();
  });

  it('lets you put it somewhere else', async () => {
    const user = userEvent.setup();
    const onTell = vi.fn();
    renderNacre(<PortraitTell groups={portraitGroups} guess={guessFixtureKind} onTell={onTell} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Tell Conch something about you' }),
      'Climbing on Sundays',
    );
    await user.click(screen.getByRole('button', { name: /Goes in What you’re into/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'People' }));
    expect(screen.getByRole('button', { name: /Goes in People/ })).toBeVisible();
    await user.click(screen.getByRole('textbox', { name: 'Tell Conch something about you' }));
    await user.keyboard('{Enter}');
    expect(onTell).toHaveBeenCalledWith('Climbing on Sundays', 'person');
  });
});

describe('FactChip', () => {
  it('names a learned fact in words, and arriving plays its light once', async () => {
    const { container } = renderNacre(
      <FactChip
        text="Prefers metric units"
        learned
        arriving
        label="How you like answers"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const chip = screen.getByRole('button', {
      name: 'Prefers metric units, learned from your chats',
    });
    expect(chip).toHaveAttribute('data-arriving');
    await expectAccessible(container);
  });
});

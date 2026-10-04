import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { portraitCards, portraitFacts, portraitSuggested } from './fixtures';
import { Portrait, type PortraitProps } from './Portrait';

function setup(over: Partial<PortraitProps> = {}) {
  const props: PortraitProps = {
    name: 'George',
    onNameChange: vi.fn(),
    summary: 'SDM at Amazon · Lives in Berlin',
    cards: portraitCards,
    facts: portraitFacts,
    onAdd: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onKeep: vi.fn(),
    onKeepAll: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
  return { ...renderNacre(<Portrait {...props} />), props };
}

const card = (title: string) => screen.getByRole('region', { name: title });

describe('Portrait', () => {
  it('shows who you are in cards, each fact a chip', async () => {
    const { container } = setup();
    expect(screen.getByRole('textbox', { name: 'What should I call you?' })).toHaveValue('George');
    expect(screen.getByText('SDM at Amazon · Lives in Berlin')).toBeVisible();
    expect(
      within(card('People')).getByRole('button', { name: 'Lina, daughter · born 8 June 2025' }),
    ).toBeVisible();
    await expectAccessible(container);
  });

  it('adds a fact in place, with its detail for a person', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(within(card('People')).getByRole('button', { name: 'Add to People' }));
    await user.keyboard('Sam');
    await user.click(within(card('People')).getByRole('textbox', { name: 'Who they are to you' }));
    await user.keyboard('brother{Enter}');
    expect(props.onAdd).toHaveBeenCalledWith({ kind: 'person', text: 'Sam', detail: 'brother' });
  });

  it('changes or removes a fact from its chip; Escape leaves it as it was', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'Graphics programming' }));
    const field = await screen.findByRole('textbox', { name: 'Interests' });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.keyboard('Shaders{Enter}');
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f6', text: 'Shaders' }),
    );
    await user.click(screen.getByRole('button', { name: 'Game dev by night' }));
    await user.keyboard('{Escape}');
    expect(props.onChange).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Game dev by night' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(props.onRemove).toHaveBeenCalledWith('f7');
  });

  it('offers what it read in your words to keep or dismiss, and says so once', async () => {
    const user = userEvent.setup();
    const { props, container } = setup({ suggested: portraitSuggested });
    expect(screen.getByRole('status')).toHaveTextContent('I read 2 cards in your words');
    await user.click(screen.getByRole('button', { name: 'Keep “Indie hacking”' }));
    expect(props.onKeep).toHaveBeenCalledWith('s2');
    await user.click(screen.getByRole('button', { name: 'Dismiss “Antonis and Poly”' }));
    expect(props.onDismiss).toHaveBeenCalledWith('s1');
    await user.click(screen.getByRole('button', { name: 'Keep all' }));
    expect(props.onKeepAll).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('starts empty with an example on each card', () => {
    setup({ name: '', facts: [], summary: undefined });
    expect(screen.getByText('e.g. Designer at a small studio')).toBeVisible();
    expect(screen.getByText(/Add a few things below/)).toBeVisible();
  });
});

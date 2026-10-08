import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { formatAmount, unitFor, writeAmount } from './amounts';
import { loaf, shakshuka } from './fixtures';
import { stepIngredients, stepPieces, type RecipeData } from './recipe';
import { RecipeCard } from './RecipeCard';
import { formatClock, formatDuration, formatSpan } from './time';
import { resetKitchenTimers } from './timers';

beforeEach(() => {
  sessionStorage.clear();
  resetKitchenTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetKitchenTimers();
});

describe('amounts', () => {
  it.each([
    [0.5, '½'],
    [1.5, '1½'],
    [1 / 3, '⅓'],
    [2 / 3, '⅔'],
    [0.75, '¾'],
    [2.25, '2¼'],
    [3, '3'],
    [2.98, '3'],
    [0.45, '½'],
    [1.42, '1⅜'],
    [12.4, '12'],
    [452, '450'],
  ])('writes %d as %s', (n, text) => {
    expect(formatAmount(n)).toBe(text);
  });

  it('writes ranges, and units that agree with them', () => {
    expect(writeAmount({ from: 2, to: 3 })).toBe('2–3');
    expect(writeAmount({ from: 1, to: 1 })).toBe('1');
    expect(unitFor('cup', 2)).toBe('cups');
    expect(unitFor('cups', 0.5)).toBe('cup');
    expect(unitFor('pinch', 3)).toBe('pinches');
    expect(unitFor('tbsp', 3)).toBe('tbsp');
    expect(unitFor('clove', { from: 1, to: 2 })).toBe('cloves');
  });
});

describe('time', () => {
  it('says lengths of time as a recipe does, and as a clock', () => {
    expect(formatDuration(2400)).toBe('40 min');
    expect(formatDuration(4800)).toBe('1 hr 20 min');
    expect(formatDuration(30)).toBe('30 sec');
    expect(formatDuration(2 * 86400)).toBe('2 days');
    expect(formatSpan(1200, 1500)).toBe('20–25 min');
    expect(formatSpan(3600, 7200)).toBe('1–2 hr');
    expect(formatClock(245_000)).toBe('4:05');
    expect(formatClock(3_750_000)).toBe('1:02:30');
  });
});

describe('steps', () => {
  it('finds the ingredients a step uses, singular or plural', () => {
    const step = (n: number) => shakshuka.steps[n]?.text ?? '';
    const named = (n: number) =>
      stepIngredients(step(n), shakshuka.ingredients).map((i) => shakshuka.ingredients[i]?.item);
    expect(named(0)).toEqual(['olive oil', 'large onion', 'red pepper', 'Salt and pepper']);
    expect(named(1)).toEqual(['garlic', 'ground cumin', 'smoked paprika']);
    expect(named(3)).toEqual(['eggs']);
    expect(stepIngredients('Add the berries.', [{ text: '1 cup berry', item: 'berry' }])).toEqual([
      0,
    ]);
  });

  it('cuts a step’s words around its timers, and ignores timers that don’t fit', () => {
    expect(
      stepPieces({ text: 'Bake for 20 minutes.', timers: [{ start: 9, end: 19, seconds: 1200 }] }),
    ).toEqual([
      { kind: 'text', text: 'Bake for ' },
      { kind: 'timer', text: '20 minutes', timer: { start: 9, end: 19, seconds: 1200 }, index: 0 },
      { kind: 'text', text: '.' },
    ]);
    expect(stepPieces({ text: 'Short.', timers: [{ start: 2, end: 99, seconds: 60 }] })).toEqual([
      { kind: 'text', text: 'Short.' },
    ]);
  });
});

describe('RecipeCard', () => {
  it('shows the recipe, accessibly, with only its own page as a link', async () => {
    const { container } = renderNacre(<RecipeCard recipe={shakshuka} />);
    const card = screen.getByRole('article', { name: 'Shakshuka with feta and herbs' });
    expect(within(card).getByLabelText('Takes 40 min')).toBeInTheDocument();
    expect(screen.getByLabelText('Rated 4.8 out of 5 by 1,342 people')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open on Good Kitchen/ });
    expect(link).toHaveAttribute('href', 'https://goodkitchen.example.org/recipes/shakshuka');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    // The photo is the chat's own copy, and decoration: the title says what it is.
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    await expectAccessible(container);
  });

  it('draws a page that isn’t https as text, never a link', () => {
    const recipe: RecipeData = { ...loaf, source: { site: 'x', url: 'javascript:alert(1)' } };
    renderNacre(<RecipeCard recipe={recipe} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('rescales every amount from the stepper, from the keyboard, and keeps it for the session', async () => {
    const { unmount } = renderNacre(<RecipeCard recipe={shakshuka} stateKey="k" />);
    const more = screen.getByRole('button', { name: 'More servings' });
    more.focus();
    await userEvent.keyboard('{Enter}{Enter}');
    expect(screen.getByRole('group', { name: 'How many it makes' })).toHaveTextContent(
      '6 servings',
    );
    expect(screen.getByRole('checkbox', { name: '3 tbsp olive oil' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '2¼ tsp ground cumin' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: '3–4½ cloves garlic, crushed' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '¾ tsp sugar' })).toBeInTheDocument();
    unmount();
    renderNacre(<RecipeCard recipe={shakshuka} stateKey="k" />);
    expect(screen.getByRole('group', { name: 'How many it makes' })).toHaveTextContent(
      '6 servings',
    );
  });

  it('scales by batches when the page didn’t say how many it makes', async () => {
    const recipe: RecipeData = { ...loaf, yield: undefined };
    renderNacre(<RecipeCard recipe={recipe} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make more' }));
    expect(screen.getByRole('group', { name: 'How many it makes' })).toHaveTextContent('2×');
    expect(screen.getByRole('checkbox', { name: '1000 g strong white flour' })).toBeInTheDocument();
  });

  it('ticks ingredients off, with a press or Space, and counts them', async () => {
    renderNacre(<RecipeCard recipe={shakshuka} />);
    const oil = screen.getByRole('checkbox', { name: '2 tbsp olive oil' });
    await userEvent.click(oil);
    expect(oil).toBeChecked();
    expect(oil.closest('li')).toHaveAttribute('data-checked');
    screen.getByRole('checkbox', { name: '6 eggs' }).focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('heading', { name: /Ingredients/ })).toHaveTextContent('2 of 12');
  });

  it('starts a timer from the words of a step, pauses it, and chimes and tells the app when it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onTimerDone = vi.fn();
    renderNacre(<RecipeCard recipe={shakshuka} onTimerDone={onTimerDone} />);
    await user.click(screen.getByRole('button', { name: '1 minute: start a 1 min timer' }));
    const running = screen.getByRole('button', { name: /^Pause the 1 min timer/ });
    expect(screen.getByRole('list', { name: 'Timers' })).toHaveTextContent('Step 2');
    await user.click(running);
    expect(
      screen.getByRole('button', { name: /^Carry on with the 1 min timer/ }),
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(onTimerDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Carry on with the 1 min timer/ }));
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(onTimerDone).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Step 2', done: true }),
      shakshuka,
    );
    expect(screen.getByText('Step 2: timer done.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 min timer done: put it away' }));
    expect(screen.queryByRole('list', { name: 'Timers' })).not.toBeInTheDocument();
  });

  it('keeps a timer running when the card goes away and comes back', async () => {
    const { unmount } = renderNacre(<RecipeCard recipe={shakshuka} />);
    await userEvent.click(screen.getByRole('button', { name: '15 minutes: start a 15 min timer' }));
    unmount();
    renderNacre(<RecipeCard recipe={shakshuka} />);
    expect(screen.getByRole('button', { name: /^Pause the 15 min timer/ })).toBeInTheDocument();
  });

  it('folds a long method, and shows it all on request', async () => {
    renderNacre(<RecipeCard recipe={shakshuka} stepsLimit={3} />);
    expect(screen.getAllByText(/^Step \d:/)).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: /Show all 6 steps/ }));
    expect(screen.getAllByText(/^Step \d:/)).toHaveLength(6);
  });

  it('keeps nutrition folded until asked', async () => {
    renderNacre(<RecipeCard recipe={shakshuka} />);
    expect(screen.queryByText('Protein')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Nutrition per serving/ }));
    expect(screen.getByText('Protein')).toBeInTheDocument();
  });
});

describe('cook mode', () => {
  it('shows one step at a time, moves with the arrow keys, and keeps the screen on while open', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    renderNacre(<RecipeCard recipe={shakshuka} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cook' }));
    const sheet = screen.getByRole('dialog', { name: 'Shakshuka with feta and herbs' });
    expect(sheet).toHaveTextContent('Step 1 of 6');
    expect(within(sheet).getByRole('button', { name: /Next/ })).toHaveFocus();
    expect(request).toHaveBeenCalledWith('screen');
    // The step's ingredients, scaled as the card is.
    const needs = within(sheet).getByRole('region', { name: 'You’ll need' });
    expect(needs).toHaveTextContent('2 tbsp olive oil');
    await expectAccessible(sheet);
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(sheet).toHaveTextContent('Step 3 of 6');
    await userEvent.keyboard('{ArrowLeft}');
    expect(sheet).toHaveTextContent('Step 2 of 6');
    expect(within(sheet).getByRole('button', { name: /Back/ })).toBeEnabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(release).toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('ends on Done, and opens again where it was', async () => {
    renderNacre(<RecipeCard recipe={loaf} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cook' }));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await userEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cook' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Step 3 of 3');
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { KETTLES, MIXED } from './fixtures';
import { bestOf, discountOf, formatPrice, ratingWords, starFills } from './format';
import { askRequest, ProductShelf } from './ProductShelf';
import { clearShortlist } from './shortlist';

afterEach(() => clearShortlist());

describe('ProductShelf', () => {
  it('shows each product’s shop, name, stars, price and availability, accessibly', async () => {
    const { container } = renderNacre(<ProductShelf products={KETTLES} locale="en-US" />);
    expect(screen.getByRole('region', { name: 'Products, 3' })).toBeInTheDocument();
    const stagg = screen.getByRole('article', { name: /Stagg EKG/ });
    const card = within(stagg);
    expect(card.getByText('Fellow · Example Shop')).toBeInTheDocument();
    expect(card.getByRole('img', { name: 'Rated 4.6 out of 5 by 1,840 people' })).toBeVisible();
    expect(card.getByText('$149')).toBeInTheDocument();
    // The price before, and the reduction, in words as well as struck through.
    expect(stagg).toHaveTextContent('was $195');
    expect(stagg).toHaveTextContent(', 24% off');
    expect(card.getByText('In stock')).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: /Classic/ })).getByText('Only a few left'),
    ).toBeVisible();
    // The shop opens in a tab of its own that knows nothing about Conch.
    const open = card.getByRole('link', {
      name: 'Open Stagg EKG Electric Pour-Over Kettle, Matte Black in Example Shop',
    });
    expect(open).toHaveAttribute('href', 'https://shop.example/stagg-ekg');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    // Pictures are what Conch serves; never anything else.
    expect(stagg.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg/);
    await expectAccessible(container);
  });

  it('lays one out as a hero, a few side by side, and many on a scrolling shelf', () => {
    const { container, rerender } = renderNacre(<ProductShelf products={KETTLES.slice(0, 1)} />);
    expect(container.querySelector('section')).toHaveAttribute('data-layout', 'hero');
    expect(screen.getByRole('link', { name: /Open in Example Shop/ })).toBeInTheDocument();
    expect(screen.getByText('Holds a temperature for an hour')).toBeInTheDocument();
    // One product has nothing to compare.
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
    rerender(<ProductShelf products={KETTLES} />);
    expect(container.querySelector('section')).toHaveAttribute('data-layout', 'few');
    rerender(<ProductShelf products={MIXED} />);
    expect(container.querySelector('section')).toHaveAttribute('data-layout', 'shelf');
  });

  it('never links anywhere but a secure web page', () => {
    renderNacre(
      <ProductShelf
        products={[
          { title: 'A', url: 'javascript:alert(1)' },
          { title: 'B', url: 'http://shop.example/b' },
        ]}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('keeps a heart for the session, and counts the shortlist', async () => {
    const user = userEvent.setup();
    const { unmount } = renderNacre(<ProductShelf products={KETTLES} />);
    const heart = screen.getByRole('button', { name: /^Shortlist Stagg/ });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    await user.click(heart);
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(heart).toHaveAttribute('data-popping');
    expect(screen.getByText('1 shortlisted')).toBeInTheDocument();
    unmount();
    renderNacre(<ProductShelf products={KETTLES} />);
    expect(screen.getByRole('button', { name: /^Shortlist Stagg/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Taking it off plays nothing.
    await user.click(screen.getByRole('button', { name: /^Shortlist Stagg/ }));
    expect(screen.getByRole('button', { name: /^Shortlist Stagg/ })).not.toHaveAttribute(
      'data-popping',
    );
  });

  it('compares two or three side by side, the best of each row said in words', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<ProductShelf products={MIXED.slice(0, 4)} locale="en-US" />);
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pick two or three to see them side by side.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Compare Stagg/ }));
    await user.click(screen.getByRole('checkbox', { name: /Compare Classic/ }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getByText('Lowest')).toBeInTheDocument();
    expect(within(table).getByText('Top rated')).toBeInTheDocument();
    expect(within(table).getByText('Easiest to get')).toBeInTheDocument();
    // The lowest price is the Smeg's; the best rating the Stagg's.
    const lowest = within(table).getByText('Lowest').closest('td');
    expect(lowest).toHaveTextContent('$89.50');
    await user.click(screen.getByRole('checkbox', { name: /Compare Retro/ }));
    // Three at most: the fourth can't be picked.
    expect(screen.getByRole('checkbox', { name: /Compare Wireless/ })).toBeDisabled();
    await expectAccessible(container);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens with the first few compared when asked to', () => {
    renderNacre(<ProductShelf products={KETTLES} compare />);
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(3);
  });

  it('puts words in the composer for Ask about this, and sends nothing', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    renderNacre(<ProductShelf products={KETTLES} onAsk={onAsk} />);
    await user.click(screen.getByRole('button', { name: /^Ask about Classic/ }));
    expect(onAsk).toHaveBeenCalledWith(KETTLES[1]);
    expect(
      askRequest({
        title: 'Classic Kettle 1.7 L, Brushed Stainless Steel',
        store: 'Kitchen Things',
      }),
    ).toBe('About the “Classic Kettle 1.7 L, Brushed Stainless Steel” from Kitchen Things: ');
  });

  it('opens a product’s gallery from its photo, with ← → between pictures', async () => {
    const user = userEvent.setup();
    renderNacre(<ProductShelf products={KETTLES} />);
    await user.click(screen.getByRole('button', { name: /Look closer at Stagg.*3 pictures/ }));
    const dialog = screen.getByRole('dialog', { name: /Stagg EKG/ });
    expect(dialog).toHaveTextContent('Picture 1 of 3');
    await user.keyboard('{ArrowRight}');
    expect(dialog).toHaveTextContent('Picture 2 of 3');
    await user.click(within(dialog).getByRole('button', { name: 'Previous picture' }));
    await user.click(within(dialog).getByRole('button', { name: 'Previous picture' }));
    expect(dialog).toHaveTextContent('Picture 3 of 3');
    expect(within(dialog).getByRole('button', { name: 'Picture 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Picture 1' }));
    expect(dialog).toHaveTextContent('Picture 1 of 3');
    await expectAccessible(dialog);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves between cards with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    renderNacre(<ProductShelf products={MIXED} />);
    const photos = screen.getAllByRole('button', { name: /^Look closer/ });
    photos[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(photos[1]).toHaveFocus();
    await user.keyboard('{End}');
    // The last has no photo: its heart takes the focus instead.
    expect(
      screen.getByRole('button', { name: /^Shortlist A product with no photo/ }),
    ).toHaveFocus();
    await user.keyboard('{Home}');
    expect(photos[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(photos[0]).toHaveFocus();
  });
});

describe('product words and numbers', () => {
  it('writes prices the currency’s own way', () => {
    expect(formatPrice({ amount: 149, currency: 'USD' }, 'en-US')).toBe('$149');
    expect(formatPrice({ amount: 89.5, currency: 'USD' }, 'en-US')).toBe('$89.50');
    expect(formatPrice({ amount: 39.9, currency: 'EUR' }, 'de-DE').replace(/\s/g, ' ')).toBe(
      '39,90 €',
    );
    expect(formatPrice({ amount: 2980, currency: 'JPY' }, 'en-US')).toBe('¥2,980');
    expect(formatPrice({ amount: 5, currency: 'XYZ1' }, 'en-US')).toBe('5 XYZ1');
  });

  it('says a reduction only when there is one', () => {
    expect(discountOf({ amount: 149, currency: 'USD' }, { amount: 195, currency: 'USD' })).toBe(24);
    expect(discountOf({ amount: 20, currency: 'USD' }, { amount: 20, currency: 'USD' })).toBe(
      undefined,
    );
    expect(discountOf({ amount: 10, currency: 'USD' }, { amount: 20, currency: 'EUR' })).toBe(
      undefined,
    );
  });

  it('fills stars to the nearest half, and says them', () => {
    expect(starFills(4.6)).toEqual([1, 1, 1, 1, 0.5]);
    expect(starFills(4.2)).toEqual([1, 1, 1, 1, 0]);
    expect(starFills(4.8)).toEqual([1, 1, 1, 1, 1]);
    expect(starFills(-1)).toEqual([0, 0, 0, 0, 0]);
    expect(ratingWords({ value: 4, count: 1 })).toBe('Rated 4 out of 5 by 1 person');
  });

  it('marks a best only where one stands out', () => {
    expect(
      bestOf([
        { price: { amount: 10, currency: 'USD' }, rating: { value: 4 } },
        { price: { amount: 8, currency: 'USD' }, rating: { value: 4 } },
      ]),
    ).toEqual({ price: 1, rating: undefined, availability: undefined });
    // Prices in two currencies can't be told apart.
    expect(
      bestOf([
        { price: { amount: 10, currency: 'USD' } },
        { price: { amount: 8, currency: 'EUR' } },
      ]).price,
    ).toBeUndefined();
    expect(
      bestOf([{ availability: 'out_of_stock' }, { availability: 'in_stock' }]).availability,
    ).toBe(1);
  });
});

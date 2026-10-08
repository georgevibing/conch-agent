import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Fundamentals, QuotesCard } from './FinanceCard';
import {
  changeWords,
  compact,
  direction,
  growth,
  margin,
  money,
  niceTicks,
  percent,
} from './format';
import {
  sampleCompany,
  sampleCompare,
  sampleLosses,
  sampleNotFiled,
  sampleQuote,
  sampleQuotes,
  sampleSeries,
  sampleShelf,
} from './fixtures';

const locale = 'en-GB';

describe('QuotesCard, one instrument', () => {
  it('is one region with a sentence for screen readers, and passes axe', async () => {
    const { container } = renderNacre(<QuotesCard quotes={sampleQuotes()} locale={locale} />);
    const card = screen.getByRole('region', { name: 'Apple Inc. price' });
    expect(card).toHaveTextContent(/Apple Inc\. \(AAPL\): \$[\d,.]+/);
    expect(card).toHaveTextContent(/up \$[\d.]+ \/ [\d.]+%/);
    expect(card).toHaveTextContent(/Delayed, from Stooq\./);
    await expectAccessible(container);
  });

  it('says the direction in words and with a caret, never by colour alone', () => {
    renderNacre(<QuotesCard quotes={sampleQuotes()} locale={locale} />);
    // The word is in the pill beside the price, not only a green tint.
    expect(screen.getByText('up')).toBeInTheDocument();
  });

  it('says when the price is from, that it is delayed, and whose it is', () => {
    renderNacre(<QuotesCard quotes={sampleQuotes()} locale={locale} />);
    expect(screen.getByText(/Closed · as of .* · delayed/)).toBeInTheDocument();
    expect(
      screen.getByText(/Stooq · delayed, not live · daily closes · not financial advice/),
    ).toBeInTheDocument();
  });

  it('draws a gap, never a zero, for a field nobody sent', () => {
    renderNacre(
      <QuotesCard
        quotes={{
          items: [
            {
              symbol: 'AIR.PA',
              name: 'Airbus SE',
              currency: 'EUR',
              price: 214.3,
              asOf: '2026-10-09T16:30:00Z',
              source: 'Yahoo Finance',
            },
          ],
        }}
        locale={locale}
      />,
    );
    expect(screen.queryByText('Day range')).not.toBeInTheDocument();
    expect(screen.queryByText('Volume')).not.toBeInTheDocument();
    expect(screen.queryByText('Market cap')).not.toBeInTheDocument();
    // No previous close was sent, so there is no move at all — not "unchanged".
    expect(screen.queryByText('unchanged')).not.toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('€214.30');
  });

  it('says what the company is worth and where the share count came from', () => {
    renderNacre(<QuotesCard quotes={sampleQuotes()} locale={locale} />);
    const cap = screen.getByText('Market cap').parentElement;
    expect(cap).toHaveTextContent(/× [\d.]+bn shares, filed \w+ \d{4}/);
  });
});

describe('scrubbing the price chart', () => {
  it('reads a day with the arrow keys, and springs back to the latest', async () => {
    const user = userEvent.setup();
    const quotes = sampleQuotes();
    renderNacre(<QuotesCard quotes={quotes} locale={locale} />);
    const slider = screen.getByRole('slider');
    const latest = quotes.series?.[0]?.closes.length ?? 0;
    expect(slider).toHaveAttribute('aria-valuenow', String(latest - 1));
    slider.focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', String(latest - 3));
    // The headline follows the day being read, and says how far it is from the start.
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/\d+ \w+ 20\d\d: \$[\d,.]+, [+-][\d.]+% from the start of the range/),
    );
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', String(latest - 1));
    await user.keyboard('{ArrowLeft}{Escape}');
    expect(slider).toHaveAttribute('aria-valuenow', String(latest - 1));
  });

  it('lets go when the focus leaves', async () => {
    const user = userEvent.setup();
    const quotes = sampleQuotes();
    renderNacre(<QuotesCard quotes={quotes} locale={locale} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    const latest = (quotes.series?.[0]?.closes.length ?? 1) - 1;
    expect(slider).toHaveAttribute('aria-valuenow', String(latest - 1));
    await user.tab();
    expect(slider).toHaveAttribute('aria-valuenow', String(latest));
  });

  it('puts every close in a table, so no value needs a hover', () => {
    const quotes = sampleQuotes();
    renderNacre(<QuotesCard quotes={quotes} locale={locale} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(
      (quotes.series?.[0]?.closes.length ?? 0) - 1,
    );
    expect(within(table).getByText('Close')).toBeInTheDocument();
  });
});

describe('the range switch', () => {
  it('asks the app for the new range and holds the old chart while it lands', async () => {
    const user = userEvent.setup();
    let release: ((value: undefined) => void) | undefined;
    const waiting = new Promise<undefined>((done) => {
      release = done;
    });
    const onRange = vi.fn(async (symbol: string) => {
      await waiting;
      return sampleSeries({ symbol, period: '1Y', points: 40, every: 9, drift: 0.3 });
    });
    renderNacre(<QuotesCard quotes={sampleQuotes()} locale={locale} onRange={onRange} />);
    const range = screen.getByRole('radiogroup', { name: 'Range' });
    await user.click(within(range).getByRole('radio', { name: '1Y' }));
    expect(onRange).toHaveBeenCalledWith('AAPL', '1Y');
    // The chart it already had is still there, only quieter: no skeleton, no jump.
    expect(screen.getByRole('slider')).toBeInTheDocument();
    release?.(undefined);
    await waitFor(() =>
      expect(within(range).getByRole('radio', { name: '1Y' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('offers no range switch when the app can’t fetch one', () => {
    renderNacre(<QuotesCard quotes={sampleQuotes()} locale={locale} />);
    expect(screen.queryByRole('radiogroup', { name: 'Range' })).not.toBeInTheDocument();
  });
});

describe('QuoteShelf, several instruments', () => {
  it('is a keyboard row of chips with the chosen one large, and passes axe', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<QuotesCard quotes={sampleShelf()} locale={locale} />);
    const chips = screen.getByRole('tablist', { name: 'Instruments' });
    expect(within(chips).getAllByRole('tab')).toHaveLength(8);
    expect(screen.getByRole('region', { name: 'Apple Inc. price' })).toBeInTheDocument();
    const first = within(chips).getAllByRole('tab')[0];
    first?.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('region', { name: 'Microsoft Corp. price' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('region', { name: 'Tesla, Inc. price' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says plainly which symbols nobody had a price for', () => {
    renderNacre(<QuotesCard quotes={sampleShelf()} locale={locale} />);
    expect(screen.getByText(/No price was found for “PLTRX”/)).toBeInTheDocument();
  });

  it('carries each chip’s move in words for a screen reader', () => {
    renderNacre(<QuotesCard quotes={sampleShelf()} locale={locale} />);
    const chip = within(screen.getByRole('tablist')).getAllByRole('tab')[0];
    expect(chip).toHaveTextContent(/up \$[\d.]+ \/ [\d.]+%/);
  });
});

describe('CompareChart', () => {
  it('overlays them as percentages from the range’s start, with a table beneath', async () => {
    const { container } = renderNacre(<QuotesCard quotes={sampleCompare()} locale={locale} />);
    const card = screen.getByRole('region', {
      name: 'Apple Inc. and Microsoft Corp. and NVIDIA Corp. compared',
    });
    expect(card).toHaveTextContent(/percentages, not prices, so they share one scale/);
    // Every series' identity is in the legend and at its line's end.
    const legend = within(card).getAllByRole('list')[0];
    expect(legend).toHaveTextContent('Apple Inc.');
    expect(legend).toHaveTextContent('NVIDIA Corp.');
    const rows = within(within(card).getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(card).getByText('best')).toBeInTheDocument();
    expect(within(card).getByText('worst')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('reads every series at one date when scrubbed', async () => {
    const user = userEvent.setup();
    renderNacre(<QuotesCard quotes={sampleCompare()} locale={locale} />);
    const slider = screen.getByRole('slider', { name: 'Compare day by day' });
    slider.focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/Apple Inc\. [+-][\d.]+%.*Microsoft Corp\..*NVIDIA Corp\./),
    );
  });
});

describe('the fundamentals card', () => {
  it('shows each figure with its period, and says where it came from, and passes axe', async () => {
    const { container } = renderNacre(
      <Fundamentals
        fundamentals={{ items: [sampleCompany()], source: 'SEC EDGAR' }}
        locale={locale}
      />,
    );
    const card = screen.getByRole('region', { name: 'Apple Inc. from filings' });
    expect(card).toHaveTextContent(/revenue \$416\.16bn in CY2025, filed 30 Oct 2025/);
    expect(card).toHaveTextContent(/From SEC EDGAR filings/);
    expect(card).toHaveTextContent(/not financial advice/);
    // Revenue's own bars say each period and its filing, in words.
    expect(within(card).getByText(/CY2021: \$365\.82bn, 10-K · filed 30 Oct 2021/)).toBeDefined();
    await expectAccessible(container);
  });

  it('labels the growth and says the margins were worked out', () => {
    renderNacre(<Fundamentals fundamentals={{ items: [sampleCompany()] }} locale={locale} />);
    expect(screen.getByText(/up 6\.43% on CY2024/)).toBeInTheDocument();
    expect(screen.getByText('Gross margin').parentElement).toHaveTextContent('47.79%');
    expect(
      screen.getByText(/Worked out from the revenue and the profit of the same period \(CY2025\)/),
    ).toBeInTheDocument();
  });

  it('opens where a figure came from', async () => {
    const user = userEvent.setup();
    renderNacre(<Fundamentals fundamentals={{ items: [sampleCompany()] }} locale={locale} />);
    await user.click(screen.getByRole('button', { name: 'Where earnings per share came from' }));
    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveTextContent('10-K · filed 30 Oct 2025 · period ended 27 Sept 2025');
    expect(panel).toHaveTextContent('EarningsPerShareDiluted');
  });

  it('says a company that files elsewhere has no figures, and shows none', async () => {
    const { container } = renderNacre(
      <Fundamentals fundamentals={{ items: [sampleNotFiled()] }} locale={locale} />,
    );
    // Once as the card's own sentence, once in the summary a screen reader hears.
    expect(screen.getAllByText(/Airbus doesn’t file with the US SEC/)).toHaveLength(2);
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross margin')).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says a loss narrowed, and draws no meter for a negative margin', () => {
    renderNacre(<Fundamentals fundamentals={{ items: [sampleLosses()] }} locale={locale} />);
    expect(screen.getByText(/loss narrowed 54\.84% on CY2024/)).toBeInTheDocument();
    const margin = screen.getByText('Net margin').parentElement;
    expect(margin).toHaveTextContent('a loss');
    expect(margin).toHaveTextContent('-34.50%');
  });

  it('compares up to four companies on one scale', () => {
    renderNacre(
      <Fundamentals fundamentals={{ items: [sampleCompany(), sampleLosses()] }} locale={locale} />,
    );
    expect(
      screen.getByRole('region', { name: 'Apple Inc. and Ravenline Motors, Inc. from filings' }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText('Revenue by period')).toHaveLength(2);
  });
});

describe('reading the numbers', () => {
  it('writes money, percentages and big amounts the reader’s own way', () => {
    expect(money(257.2, 'USD', 'en-GB')).toBe('$257.20');
    expect(money(257.2, 'EUR', 'de-DE')).toMatch(/^257,20\s€$/);
    // No currency code: a plain number, two places until it's into the ten-thousands.
    expect(money(6842.1, undefined, 'en-GB')).toBe('6,842.10');
    expect(money(94210.5, undefined, 'en-GB')).toBe('94,211');
    expect(money(1.0842, 'USD', 'en-GB')).toBe('$1.0842');
    expect(compact(3.83e12, 'USD', 'en-US')).toBe('$3.83T');
    expect(percent(0.6673, 'en-GB')).toBe('+0.67%');
    expect(percent(0.6673, 'en-GB', false)).toBe('0.67%');
  });

  it('never leaves a direction to colour', () => {
    expect(direction(1)).toBe('up');
    expect(direction(-1)).toBe('down');
    expect(direction(0)).toBe('flat');
    expect(direction(undefined)).toBe('flat');
    expect(changeWords(1.7, 0.67, 'USD', 'en-GB')).toBe('up $1.70 / 0.67%');
    expect(changeWords(0, 0, 'USD', 'en-GB')).toBe('unchanged');
  });

  it('works out growth and margins only when both figures are there', () => {
    expect(growth(100, 110)).toBeCloseTo(10);
    expect(growth(-10, -5)).toBeCloseTo(50);
    expect(growth(0, 5)).toBeUndefined();
    expect(growth(undefined, 5)).toBeUndefined();
    expect(margin(25, 100)).toBe(25);
    expect(margin(25, 0)).toBeUndefined();
    expect(margin(undefined, 100)).toBeUndefined();
  });

  it('puts round numbers on an axis, with zero on one when the range crosses it', () => {
    expect(niceTicks(243.98, 258.4, 3)).toEqual([245, 250, 255]);
    expect(niceTicks(-4, 20, 3)).toContain(0);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe('a quote that changes', () => {
  it('rolls only the digits that changed', () => {
    const { rerender } = renderNacre(
      <QuotesCard
        quotes={{ items: [sampleQuote({ price: 257.2, series: sampleSeries() })] }}
        locale={locale}
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent('$257.20');
    rerender(
      <QuotesCard
        quotes={{ items: [sampleQuote({ price: 258.4, series: sampleSeries() })] }}
        locale={locale}
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent('$258.40');
  });
});

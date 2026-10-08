import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CryptoMarket, QuotesCard } from './FinanceCard';
import {
  sampleBusyCoin,
  sampleCoinQuotes,
  sampleCoinSeries,
  sampleMarket,
  sampleSharedSymbol,
  sampleSmallCoin,
} from './fixtures';
import { coinHue, money, priceDigits } from './format';
import type { FinancePeriod } from './types';

const locale = 'en-GB';

describe('a coin’s card', () => {
  it('is one region with a sentence for screen readers, and passes axe', async () => {
    const { container } = renderNacre(
      <QuotesCard quotes={sampleCoinQuotes()} locale={locale} onRange={vi.fn()} />,
    );
    const card = screen.getByRole('region', { name: 'Bitcoin price' });
    expect(card).toHaveTextContent(
      /Bitcoin \(BTC\), 1st by market value: \$67,187, down 0\.31% in 24 hours\./,
    );
    expect(card).toHaveTextContent(/Trades 24\/7/);
    expect(card).toHaveTextContent(/38% below its high of \$109,000, 20 Jan 2025/);
    expect(card).toHaveTextContent(
      /CoinGecko’s average across exchanges, not one exchange’s price\./,
    );
    await expectAccessible(container);
  });

  it('says 24/7 instead of a session, and that an aggregator’s price isn’t one exchange’s', () => {
    renderNacre(<QuotesCard quotes={sampleCoinQuotes()} locale={locale} />);
    expect(
      screen.getByText(/^24\/7 · as of \d{2}:\d{2} · an average across exchanges$/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Closed/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /CoinGecko · an average across exchanges, not one exchange’s price · not live · not financial advice/,
      ),
    ).toBeInTheDocument();
  });

  it('shows the rank, market value beside fully diluted value, and the supply of its maximum', () => {
    renderNacre(<QuotesCard quotes={sampleCoinQuotes()} locale={locale} />);
    const card = screen.getByRole('region', { name: 'Bitcoin price' });
    expect(within(card).getByTitle('By market value')).toHaveTextContent('#1');
    expect(within(card).getByText('Market value')).toBeInTheDocument();
    expect(within(card).getByText('Fully diluted')).toBeInTheDocument();
    expect(within(card).getByText('if all 21m existed')).toBeInTheDocument();
    expect(within(card).getByText('93% of the maximum')).toBeInTheDocument();
    expect(
      within(card).getByText('19.61m BTC in circulation, of at most 21m that can ever exist.'),
    ).toBeInTheDocument();
  });

  it('says “no maximum” in words for a coin without one, and invents no fully diluted value', async () => {
    const { container } = renderNacre(
      <QuotesCard quotes={sampleSmallCoin()} locale={locale} onRange={vi.fn()} />,
    );
    const card = screen.getByRole('region', { name: 'Celestia price' });
    expect(
      within(card).getByText('221.23m TIA in circulation. No maximum: new coins keep being made.'),
    ).toBeInTheDocument();
    expect(within(card).getByText('no maximum, so none worked out')).toBeInTheDocument();
    expect(within(card).getByText('20% of what exists')).toBeInTheDocument();
    expect(within(card).getAllByText(/80% below its high of \$20\.85/)).toHaveLength(2);
    await expectAccessible(container);
  });

  it('names the other coins that share its symbol', () => {
    renderNacre(<QuotesCard quotes={sampleSharedSymbol()} locale={locale} />);
    expect(
      screen.getByText(
        'Also “UNI”: Unicorn Token (#3,412), UNI COIN. This is the one worth the most.',
      ),
    ).toBeInTheDocument();
  });

  it('a change chip is the range too: pressing 7d asks for the week, and arrows move along', async () => {
    const user = userEvent.setup();
    const onRange = vi.fn(async (symbol: string, period: FinancePeriod) =>
      sampleCoinSeries({ symbol, period }),
    );
    renderNacre(<QuotesCard quotes={sampleCoinQuotes()} locale={locale} onRange={onRange} />);
    const chips = screen.getByRole('radiogroup', { name: 'Moves, and the range the chart draws' });
    const month = within(chips).getByRole('radio', { name: 'Last 30 days: up 12.08%' });
    expect(month).toHaveAttribute('aria-checked', 'true');
    await user.click(within(chips).getByRole('radio', { name: 'Last 7 days: up 4.20%' }));
    expect(onRange).toHaveBeenCalledWith('BTC', '1W');
    await waitFor(() =>
      expect(
        screen.getByRole('table', { name: /prices over the last 7 days/ }),
      ).toBeInTheDocument(),
    );
    // The headline's move follows the chip.
    expect(screen.getByRole('region', { name: 'Bitcoin price' })).toHaveTextContent('in 7 days');
    // The keyboard: arrows move along the row, as any segmented control.
    await user.keyboard('{ArrowLeft}');
    expect(within(chips).getByRole('radio', { name: /Last 24 hours/ })).toHaveFocus();
  });

  it('draws the last hour from the day’s chart, with times instead of dates', async () => {
    const user = userEvent.setup();
    const onRange = vi.fn(async (symbol: string) => sampleCoinSeries({ symbol, period: '1D' }));
    renderNacre(<QuotesCard quotes={sampleCoinQuotes()} locale={locale} onRange={onRange} />);
    await user.click(screen.getByRole('radio', { name: /Last hour/ }));
    expect(onRange).toHaveBeenCalledWith('BTC', '1D');
    await waitFor(() =>
      expect(screen.getByRole('table', { name: /prices over the last hour/ })).toBeInTheDocument(),
    );
    // Twelve five-minute points and the hour's end: a short table, every row a time.
    const table = screen.getByRole('table', { name: /prices over the last hour/ });
    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(16);
    expect(rows[1]).toHaveTextContent(/\d{2}:\d{2}/);
  });

  it('without a way to fetch, the moves are a plain list, every one said in words', () => {
    renderNacre(<QuotesCard quotes={sampleCoinQuotes()} locale={locale} />);
    const list = screen.getByRole('list', { name: 'Moves' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getByLabelText('Last year: up 140.40%')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('opens the description with More, and says where it’s from only in plain words', async () => {
    const user = userEvent.setup();
    renderNacre(<QuotesCard quotes={sampleCoinQuotes()} locale={locale} />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('SHA-256')).toBeInTheDocument();
    expect(screen.getByText('Since 3 Jan 2009')).toBeInTheDocument();
  });

  it('when CoinGecko was busy, says so and draws Stooq’s price as any other, never its figures', async () => {
    const { container } = renderNacre(<QuotesCard quotes={sampleBusyCoin()} locale={locale} />);
    expect(screen.getByText('CoinGecko is busy; prices from Stooq.')).toBeInTheDocument();
    expect(screen.getByText(/^24\/7 · as of/)).toBeInTheDocument();
    expect(screen.queryByText('Market value')).not.toBeInTheDocument();
    expect(screen.queryByText('Supply')).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('keeps the share bar in the footer', () => {
    renderNacre(
      <QuotesCard
        quotes={sampleCoinQuotes()}
        locale={locale}
        share={<button type="button">Share</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Share' }).closest('footer')).not.toBeNull();
  });
});

describe('the crypto market', () => {
  it('is one region with a sentence, a dominance bar in words, and a table; passes axe', async () => {
    const { container } = renderNacre(<CryptoMarket market={sampleMarket()} locale={locale} />);
    const card = screen.getByRole('region', { name: 'The crypto market' });
    expect(card).toHaveTextContent(
      /every coin CoinGecko tracks is worth \$2\.41tn together, up 1\.23% in 24 hours\. Bitcoin is 54\.62% of it, ether 13\.21%\./,
    );
    // Dominance is named and numbered, never colour alone; "everything else" is worked out.
    const key = within(card).getByText('Everything else').closest('li');
    expect(key).toHaveTextContent('32.17%');
    const table = within(card).getByRole('table', { name: 'The biggest coins' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(11);
    expect(rows[1]).toHaveTextContent(/1\s*BTCBitcoinBTC.*\$67,187.*down 0\.31%/);
    expect(within(table).getAllByText(/over 7 days/)).toHaveLength(10);
    await expectAccessible(container);
  });

  it('keeps the share bar, and says it is an average and not advice', () => {
    renderNacre(
      <CryptoMarket
        market={sampleMarket()}
        locale={locale}
        share={<button type="button">Share</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Share' }).closest('footer')).toHaveTextContent(
      /averages across exchanges, not one exchange’s prices · not live · not financial advice/,
    );
  });
});

describe('a coin’s numbers', () => {
  it('keeps the digits of a coin worth a fraction of a cent', () => {
    expect(priceDigits(0.00001234)).toBe(7);
    expect(money(0.00001234, 'USD', locale)).toBe('$0.0000123');
    expect(money(67_187, 'USD', locale)).toBe('$67,187');
  });

  it('gives a known coin its own hue and any other one from its letters', () => {
    expect(coinHue('btc')).toBe(62);
    expect(coinHue('ZZZ')).toBe(coinHue('ZZZ'));
  });
});

/**
 * `GET /api/finance/history?symbol=AAPL&period=1Y`: the daily closes behind a
 * finance card's range switch. Pressing 5Y on a card shouldn't need another
 * turn of the conversation, so the card asks the gateway directly.
 *
 * It is a plain, authenticated read, guarded like every other `/api` route
 * (`security.ts`), and it adds no new power: the symbol is checked against the
 * protocol's own shape, the period against its own list, and the answer comes
 * from the same cached public reader the `quote` tool uses, through the same
 * SSRF-guarded fetcher. Nothing about the chat is sent anywhere.
 *
 * A coin's card also sends the coin's CoinGecko id (`coin=bitcoin`), so the
 * range it asks for is the very coin it shows, not whichever coin is biggest
 * by that symbol today, and the currency it's priced in (`currency=EUR`).
 */
import { CoinId, FinancePeriod, TickerSymbol } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import { coinCurrency, type FinanceSource } from './finance';
import { OutsideError } from './outside';

export function registerFinanceRoutes(app: FastifyInstance, source: FinanceSource): void {
  app.get<{
    Querystring: { symbol?: unknown; period?: unknown; coin?: unknown; currency?: unknown };
  }>('/api/finance/history', async (request, reply) => {
    const symbol = TickerSymbol.safeParse(request.query.symbol);
    const period = FinancePeriod.safeParse(request.query.period ?? '1Y');
    const coin =
      request.query.coin === undefined ? undefined : CoinId.safeParse(request.query.coin);
    const currency =
      request.query.currency === undefined ? undefined : coinCurrency(request.query.currency);
    if (
      !symbol.success ||
      !period.success ||
      (coin && !coin.success) ||
      (request.query.currency !== undefined && !currency)
    )
      return reply.code(400).send({
        error: 'bad-request',
        message:
          'Say which symbol, one of 1D, 1W, 1M, 3M, 6M, 1Y, 5Y or MAX, and for a coin its CoinGecko id and one of USD, EUR, GBP, JPY, CHF, CAD or AUD.',
      });
    const stop = new AbortController();
    reply.raw.on('close', () => stop.abort());
    try {
      const at = coin?.success
        ? source.coinById(coin.data, symbol.data)
        : await source.resolve('finance-card', symbol.data, stop.signal);
      const series = at
        ? await source.history('finance-card', at, period.data, stop.signal, currency)
        : undefined;
      if (!series)
        return reply.code(404).send({
          error: 'not-found',
          message: `No public source here has ${period.data} of prices for “${symbol.data}”.`,
        });
      return reply.header('cache-control', 'no-store').send({ series });
    } catch (error) {
      if (stop.signal.aborted) return reply.code(499).send();
      return reply.code(502).send({
        error: 'unavailable',
        message:
          error instanceof OutsideError
            ? error.message
            : 'The price service didn’t answer. Try again in a moment.',
      });
    }
  });
}

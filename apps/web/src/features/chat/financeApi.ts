import { PriceSeries, type FinancePeriod } from '@conch/protocol';
import { z } from 'zod';

import { request } from '../../api/client';

const Answer = z.object({ series: PriceSeries });

/**
 * The closes behind a finance card's range switch (`GET /api/finance/history`).
 * Pressing 5Y shouldn't need another turn of the conversation, so the card
 * asks the gateway, which answers from the same cached public reader the
 * `quote` tool uses. It's the ordinary authenticated `/api` path.
 *
 * Nothing is thrown at the card: a symbol nobody has, or a service that didn't
 * answer, comes back as `undefined` and the card keeps the range it had.
 */
export async function priceHistory(
  symbol: string,
  period: FinancePeriod,
  coin?: { id: string; currency?: string },
): Promise<PriceSeries | undefined> {
  try {
    const query = new URLSearchParams({ symbol, period });
    // A coin's card asks for the very coin it shows, in the currency it shows it in.
    if (coin) {
      query.set('coin', coin.id);
      if (coin.currency) query.set('currency', coin.currency);
    }
    const answer = await request(Answer, `/api/finance/history?${query.toString()}`);
    return answer.series;
  } catch {
    return undefined;
  }
}

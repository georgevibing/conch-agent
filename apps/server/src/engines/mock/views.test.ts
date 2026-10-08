import { ToolView } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { cleanView } from '../../conversations/views';
import { pretendFind } from './views';

describe('the mock’s pretend app finds', () => {
  it.each([
    ['What’s on my calendar today?', 'google_calendar_briefing', 'agenda'],
    ['Find the budget email', 'google_mail_search', 'mail'],
    ['find the launch deck in Drive', 'google_drive_search', 'files'],
    ['What did #design say about onboarding?', 'slack_read_channel', 'messages'],
    ['What’s the weather in Lisbon?', 'weather', 'weather'],
    ['Find me a recipe for tomato rice', 'recipe', 'recipe'],
    ['Shop for a kettle', 'product_details', 'products'],
    ['Coffee near the Ritz?', 'places', 'places'],
    ['Show me a video of sourdough shaping', 'video_search', 'videos'],
    ['Who was Ada Lovelace?', 'knowledge_card', 'knowledge'],
    ['Find books by Ursula K. Le Guin', 'book_search', 'books'],
    ['What’s on with Severance?', 'show_search', 'shows'],
    ['Make me a pie chart of my spending', 'chart_show', 'chart'],
    ['Chart last week’s orders', 'chart_show', 'chart'],
    ['What’s AAPL at?', 'quote', 'quotes'],
    ['Compare AAPL and MSFT', 'quote', 'quotes'],
    ['How is Apple doing financially?', 'fundamentals', 'fundamentals'],
    ['What’s BTC at?', 'quote', 'quotes'],
    ['How’s crypto doing?', 'crypto_market', 'crypto-market'],
    ['How is crypto doing today?', 'crypto_market', 'crypto-market'],
  ])('“%s” finds a %s with a view that logs as it is', (prompt, tool, kind) => {
    const found = pretendFind(prompt);
    expect(found?.tool).toBe(tool);
    expect(found?.view.kind).toBe(kind);
    expect(ToolView.safeParse(found?.view).success).toBe(true);
    expect(cleanView(found?.view)).toEqual(found?.view);
  });

  it('leaves every other prompt alone', () => {
    expect(pretendFind('search my gmail for lunch')).toBeUndefined();
    expect(pretendFind('catch me up on #launch')).toBeUndefined();
    // Other journeys' prompts that only mention the weather.
    expect(pretendFind('Every morning, give me a weather briefing')).toBeUndefined();
    expect(pretendFind('What is the weather like in Lisbon tomorrow')).toBeUndefined();
    // Other journeys' prompts that only mention a chart.
    expect(pretendFind('Put a chart of the numbers in the deck')).toBeUndefined();
    expect(pretendFind('Can you make a pie chart file for the deck?')).toBeUndefined();
    // Money's phrases are narrow on purpose: only a ticker in capitals.
    expect(pretendFind('compare the two kettles')).toBeUndefined();
    expect(pretendFind('compare apples and oranges')).toBeUndefined();
    expect(pretendFind('what’s the plan at this point')).toBeUndefined();
    expect(pretendFind('how is the build doing financially? joke')).toBeUndefined();
    // Crypto's question is narrow too: only how the market as a whole is doing.
    expect(pretendFind('Write a crypto library for hashing')).toBeUndefined();
    expect(pretendFind('Explain how crypto doing works in Node')).toBeUndefined();
    expect(pretendFind('what is crypto.randomUUID?')).toBeUndefined();
    expect(pretendFind('how’s the crypto module doing in the benchmark')).toBeUndefined();
  });

  it('shows a coin’s own card for “What’s BTC at?”: 24/7, CoinGecko’s figures, its supply', () => {
    const found = pretendFind('What’s BTC at?', Date.parse('2026-10-09T21:06:00Z'));
    if (found?.view.kind !== 'quotes') throw new Error('no quotes');
    const btc = found.view.items[0];
    expect(btc).toMatchObject({ class: 'crypto', dayState: 'always', source: 'CoinGecko' });
    expect(btc?.crypto).toMatchObject({ rank: 1, supply: { max: 21_000_000 } });
    expect(found.view.series?.[0]?.times?.length).toBe(found.view.series?.[0]?.closes.length);
    // A share is still a share.
    const aapl = pretendFind('What’s AAPL at?');
    if (aapl?.view.kind !== 'quotes') throw new Error('no quotes');
    expect(aapl.view.items[0]?.class).toBe('stock');
  });
});

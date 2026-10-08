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
  });
});

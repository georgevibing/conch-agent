import { describe, expect, it } from 'vitest';

import { APP_TOOL_WORDS, appToolLine, GoogleToolName } from './app-tools';
import { GOOGLE_APP_CAPABILITIES } from './google';
import { SlackToolName } from './slack';

describe('how the chat names Conch’s own app tools', () => {
  it('has words for every tool of every app, and no others', () => {
    expect(Object.keys(APP_TOOL_WORDS).sort()).toEqual(
      [...GoogleToolName.options, ...SlackToolName.options].sort(),
    );
    for (const words of Object.values(APP_TOOL_WORDS))
      expect([...Object.keys(GOOGLE_APP_CAPABILITIES), 'slack']).toContain(words.app);
  });

  it('says what it is doing, then what it did, as Claude Code or an API engine names it', () => {
    expect(appToolLine('mcp__conch__google_calendar_briefing', { running: true })).toEqual({
      app: 'google-calendar',
      title: 'Looking at your calendar',
    });
    expect(appToolLine('google_calendar_briefing', { running: false })?.title).toBe(
      'Looked at your calendar',
    );
    expect(
      appToolLine('mcp__conch__google_mail_search', { running: false, input: { query: 'budget' } }),
    ).toEqual({ app: 'gmail', title: 'Searched your mail', summary: '“budget”' });
    expect(appToolLine('mcp__conch__google_drive_search', { running: false })?.title).toBe(
      'Searched Drive',
    );
  });

  it('names the channel from what it found, never from an id it was given', () => {
    const view = { kind: 'messages' as const, place: '#design', items: [] };
    expect(
      appToolLine('mcp__conch__slack_read_channel', {
        running: false,
        input: { channel: 'C0123' },
        view,
      }),
    ).toEqual({ app: 'slack', title: 'Read #design' });
    expect(
      appToolLine('mcp__conch__slack_read_channel', { running: true, input: { channel: 'C0123' } })
        ?.title,
    ).toBe('Catching up on a channel');
  });

  it('leaves every other tool alone', () => {
    expect(appToolLine('mcp__linear__list_issues', { running: false })).toBeUndefined();
    expect(appToolLine('mcp__conch__ask', { running: false })).toBeUndefined();
    expect(appToolLine('Bash', { running: false })).toBeUndefined();
  });
});

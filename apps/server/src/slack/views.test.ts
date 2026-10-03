import { ToolView } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { channelView, searchView, slackPlain } from './views';

describe('Slack’s markup as plain words', () => {
  it('names people, channels and links the way Slack shows them', () => {
    const people = new Map([['U02', 'Sam Rivera']]);
    expect(
      slackPlain(
        '<@U01|ada> and <@U02> and <@U03>: see <#C01|launch>, <https://example.org/doc|the doc> or <https://example.org> &amp; <mailto:a@example.org|a@example.org> <!here> <!subteam^S1|@design> 1 &lt; 2 &gt; 0',
        (id) => people.get(id),
      ),
    ).toBe(
      '@ada and @Sam Rivera and @someone: see #launch, the doc or https://example.org & a@example.org @here @design 1 < 2 > 0',
    );
  });

  it('keeps line breaks, and never brings markup back', () => {
    expect(slackPlain('one\ntwo &lt;b&gt;three&lt;/b&gt;')).toBe('one\ntwo <b>three</b>');
  });
});

describe('a channel catch-up as messages', () => {
  it('draws the channel and its newest thirty, oldest first', () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({
      from: 'Sam Rivera',
      text: `message ${i}`,
      time: new Date(Date.UTC(2026, 9, 3, 9, i)).toISOString(),
    }));
    const view = channelView({ channel: { id: 'C01', name: 'launch' }, messages });
    expect(ToolView.safeParse(view).success).toBe(true);
    if (view?.kind !== 'messages') throw new Error('not messages');
    expect(view.place).toBe('#launch');
    expect(view.items).toHaveLength(30);
    expect(view.items[0]?.text).toBe('message 10');
    expect(view.items.at(-1)?.text).toBe('message 39');
  });

  it('copes with missing authors, texts and times', () => {
    const view = channelView({
      channel: { id: 'C01' },
      messages: [
        { time: '2026-10-03T09:00:00.000Z' },
        { from: 'Ada', text: 'no time' },
        { from: '  ', text: 'x'.repeat(3000), time: '2026-10-03T09:01:00.000Z' },
      ],
    });
    if (view?.kind !== 'messages') throw new Error('not messages');
    expect(view.place).toBeUndefined();
    expect(view.items.map((m) => m.author)).toEqual(['someone', 'someone']);
    expect(view.items[1]?.text.length).toBe(2000);
    expect(channelView('nonsense')).toBeUndefined();
  });
});

describe('a search as messages', () => {
  it('keeps Slack’s own links only, and names the channel when they share one', () => {
    const view = searchView({
      total: 2,
      matches: [
        {
          from: 'Ada',
          text: 'Thursday works',
          time: '2026-10-02T10:00:00.000Z',
          channel: { name: 'design' },
          link: 'https://acme.slack.com/archives/C01/p1',
        },
        {
          from: 'Sam',
          text: 'Thursday it is',
          time: '2026-10-02T11:00:00.000Z',
          channel: { name: 'design' },
          link: 'https://evil.example/archives',
        },
      ],
    });
    expect(view).toEqual({
      kind: 'messages',
      place: '#design',
      items: [
        {
          author: 'Ada',
          text: 'Thursday works',
          at: '2026-10-02T10:00:00.000Z',
          url: 'https://acme.slack.com/archives/C01/p1',
        },
        { author: 'Sam', text: 'Thursday it is', at: '2026-10-02T11:00:00.000Z' },
      ],
    });
    const spread = searchView({
      matches: [
        { from: 'A', text: 'a', time: '2026-10-02T10:00:00.000Z', channel: { name: 'one' } },
        { from: 'B', text: 'b', time: '2026-10-02T10:00:00.000Z', channel: { name: 'two' } },
      ],
    });
    expect(spread?.kind === 'messages' && spread.place).toBeUndefined();
  });
});

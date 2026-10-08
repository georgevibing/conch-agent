import type { AudioView } from '@conch/protocol';
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';
import { musicTracks } from './MusicFound';

afterEach(() => vi.unstubAllGlobals());

const view: AudioView = {
  kind: 'audio',
  chat: 'c1',
  query: 'bohemian rhapsody',
  items: [
    {
      kind: 'song',
      title: 'Bohemian Rhapsody',
      by: 'Queen',
      duration: 355,
      artwork: {
        id: 'att_cover',
        name: 'Bohemian Rhapsody.jpg',
        mimeType: 'image/jpeg',
        size: 1000,
        kind: 'image',
        createdAt: 0,
      },
      preview: { url: 'https://audio-ssl.itunes.apple.com/a/b.m4a', whole: false },
      links: { apple: 'https://music.apple.com/us/album/x?i=1' },
    },
    { kind: 'album', title: 'A Night at the Opera', by: 'Queen' },
  ],
};

describe('music in the chat', () => {
  it('plays and shows only from Conch itself', () => {
    const [song, album] = musicTracks(view);
    expect(song?.src).toBe(
      '/api/listen?chat=c1&src=https%3A%2F%2Faudio-ssl.itunes.apple.com%2Fa%2Fb.m4a',
    );
    expect(song?.artwork).toBe('/api/attachments/att_cover');
    expect(album?.src).toBeUndefined();
  });

  it('stands in sight under its story, as a card that plays', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    await screen.findByRole('textbox', { name: 'Message Conch' });
    const push = (seq: number, event: Record<string, unknown>) =>
      FakeSocket.last?.push({
        type: 'conversation.event',
        event: { conversationId: 'c1', seq, at: 1000 + seq, ...event },
      } as never);
    act(() => {
      push(0, { type: 'user.message', messageId: 'u1', text: 'Play me Bohemian Rhapsody' });
      push(1, {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'mcp__conch__music_search',
        input: { query: 'bohemian rhapsody' },
      });
      push(2, { type: 'tool.finished', toolUseId: 't1', status: 'success', output: '{}', view });
    });
    const card = await screen.findByRole('region', {
      name: 'Music: 2 results for “bohemian rhapsody”',
    });
    expect(within(card).getByRole('button', { name: 'Play Bohemian Rhapsody' })).toBeVisible();
    for (const img of card.querySelectorAll('img'))
      expect(img.getAttribute('src')).toMatch(/^\/api\/attachments\//);
  });
});

import { describe, expect, it } from 'vitest';

import { ToolView } from '../chat-cards';
import { AudioView, listenPath } from './audio';

const song = {
  kind: 'song',
  title: 'Bohemian Rhapsody',
  by: 'Queen',
  album: 'A Night at the Opera',
  duration: 355,
  preview: { url: 'https://audio-ssl.itunes.apple.com/itunes-assets/a.m4a' },
  links: { apple: 'https://music.apple.com/us/album/x?i=1' },
};

describe('audio views (music and podcasts)', () => {
  it('is one of the views a tool can draw', () => {
    const view = ToolView.parse({ kind: 'audio', chat: 'c1', items: [song] });
    expect(view.kind).toBe('audio');
    if (view.kind === 'audio') expect(view.items[0]?.preview?.whole).toBe(false);
  });

  it('plays only from secure web addresses and links only to the web', () => {
    const insecure = { ...song, preview: { url: 'http://example.org/a.mp3' } };
    expect(AudioView.safeParse({ kind: 'audio', chat: 'c1', items: [insecure] }).success).toBe(
      false,
    );
    const script = { ...song, links: { apple: 'javascript:alert(1)' } };
    expect(AudioView.safeParse({ kind: 'audio', chat: 'c1', items: [script] }).success).toBe(false);
  });

  it('names its chat by an id, and caps how much it carries', () => {
    expect(AudioView.safeParse({ kind: 'audio', chat: '../x', items: [] }).success).toBe(false);
    const many = Array.from({ length: 13 }, () => song);
    expect(AudioView.safeParse({ kind: 'audio', chat: 'c1', items: many }).success).toBe(false);
  });

  it('plays from Conch itself, never from the other site', () => {
    expect(listenPath('c1', 'https://a.example/x.m4a?b=1&c=2')).toBe(
      '/api/listen?chat=c1&src=https%3A%2F%2Fa.example%2Fx.m4a%3Fb%3D1%26c%3D2',
    );
  });
});

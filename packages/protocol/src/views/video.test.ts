import { describe, expect, it } from 'vitest';

import { ToolView } from '../chat-cards';
import { isVideoId, videoFromUrl, VideoItem, videoPage, videoPlayer } from './video';

const item = {
  provider: 'youtube',
  id: 'dQw4w9WgXcQ',
  title: 'A song',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
} as const;

describe('video ids', () => {
  it.each([
    ['youtube', 'dQw4w9WgXcQ', true],
    ['youtube', '4gEoh3sk2A-', true],
    ['youtube', 'dQw4w9WgXc', false],
    ['youtube', 'dQw4w9WgXcQQ', false],
    ['youtube', 'dQw4w9WgX"Q', false],
    ['youtube', '../../evil?', false],
    ['vimeo', '22439234', true],
    ['vimeo', '0123', false],
    ['vimeo', '12a', false],
    ['vimeo', '1234567890123', false],
  ] as const)('%s %s is %s', (provider, id, ok) => {
    expect(isVideoId(provider, id)).toBe(ok);
  });

  it('builds a player only from a checked id, never from anything else', () => {
    expect(videoPlayer('youtube', 'dQw4w9WgXcQ', 90)).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&modestbranding=1&playsinline=1&start=90',
    );
    expect(videoPlayer('vimeo', '22439234')).toBe(
      'https://player.vimeo.com/video/22439234?autoplay=1&dnt=1',
    );
    expect(videoPlayer('youtube', 'x?y=1&a=b#c')).toBeUndefined();
    expect(videoPlayer('youtube', 'https://evil.example/')).toBeUndefined();
    expect(videoPlayer('vimeo', '1/../../x')).toBeUndefined();
    expect(videoPlayer('dailymotion' as never, '12345')).toBeUndefined();
    // A start that isn't a sensible number of seconds is left out.
    expect(videoPlayer('youtube', 'dQw4w9WgXcQ', -4)).not.toContain('start');
    expect(videoPlayer('youtube', 'dQw4w9WgXcQ', 1.5)).not.toContain('start');
    expect(videoPage('youtube', 'dQw4w9WgXcQ', 75)).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s',
    );
    expect(videoPage('vimeo', '22439234')).toBe('https://vimeo.com/22439234');
  });
});

describe('video links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', undefined],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', 'youtube', 'dQw4w9WgXcQ', 90],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'youtube', 'dQw4w9WgXcQ', 42],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', undefined],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', undefined],
    ['https://vimeo.com/22439234', 'vimeo', '22439234', undefined],
    ['https://vimeo.com/channels/staffpicks/22439234#t=30s', 'vimeo', '22439234', 30],
    ['https://player.vimeo.com/video/22439234', 'vimeo', '22439234', undefined],
  ])('%s', (url, provider, id, start) => {
    expect(videoFromUrl(url)).toEqual({ provider, id, ...(start && { start }) });
  });

  it.each([
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/watch?v=short',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
    'https://vimeo.com/about',
    'not a link',
  ])('refuses %s', (url) => {
    expect(videoFromUrl(url)).toBeUndefined();
  });
});

describe('the videos view', () => {
  it('is a tool view', () => {
    expect(ToolView.safeParse({ kind: 'videos', items: [item] }).success).toBe(true);
  });
  it('refuses an id that isn’t the site’s shape, or a page that isn’t the video’s', () => {
    expect(VideoItem.safeParse({ ...item, id: 'dQw4w9WgXc"' }).success).toBe(false);
    expect(VideoItem.safeParse({ ...item, provider: 'vimeo' }).success).toBe(false);
    expect(
      VideoItem.safeParse({ ...item, url: 'https://evil.example/?v=dQw4w9WgXcQ' }).success,
    ).toBe(false);
    expect(
      VideoItem.safeParse({ ...item, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }).success,
    ).toBe(false);
  });
});

import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { bake, boule, liveBake, videos } from './fixtures';
import { stopAllVideos } from './nowPlaying';
import { isPlayerAddress, VideoCard } from './VideoCard';
import { VideoShelf } from './VideoShelf';
import { lengthWords, publishedWords, viewsWords } from './words';

const youtube = (_v: unknown, start?: number) =>
  `https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?autoplay=1${start ? `&start=${start}` : ''}`;

afterEach(() => act(() => stopAllVideos()));

describe('VideoCard', () => {
  it('is a poster until play is pressed: nothing loads from the site before', async () => {
    const { container } = renderNacre(<VideoCard video={bake} playerFor={youtube} />);
    expect(container.querySelector('iframe')).toBeNull();
    const play = screen.getByRole('button', {
      name: 'Play: Bake the perfect sourdough loaf: a step-by-step guide for beginners, 12 minutes',
    });
    expect(play).toHaveAccessibleDescription(/^Harbour Kitchen,\s?2 years ago,\s?3.3M views$/);
    expect(screen.getByRole('link', { name: /Open on YouTube/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expectAccessible(container);
  });

  it('plays in place with Enter, in a sandboxed frame that sends only its origin', async () => {
    const { container } = renderNacre(<VideoCard video={bake} playerFor={youtube} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /^Play:/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('No player');
    expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?autoplay=1');
    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
    );
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(frame.getAttribute('allow')).toBe(
      'autoplay; encrypted-media; picture-in-picture; fullscreen',
    );
    expect(frame).toHaveAttribute('title', expect.stringContaining('YouTube player'));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('is accessible while it plays', async () => {
    const { container } = renderNacre(
      <VideoCard video={bake} renderPlayer={() => <div>The player</div>} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Play:/ }));
    expect(screen.getByText('The player')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('never makes a frame for an address that isn’t one of the two players', async () => {
    const { container } = renderNacre(
      <VideoCard video={boule} playerFor={() => 'https://evil.example/embed/x?'} />,
    );
    expect(screen.getByRole('button', { name: /can’t play here/ })).toBeDisabled();
    expect(container.querySelector('iframe')).toBeNull();
    expect(isPlayerAddress('https://player.vimeo.com/video/22439234?autoplay=1')).toBe(true);
    expect(isPlayerAddress('https://www.youtube.com/embed/aaaaaaaaaaa?')).toBe(false);
    expect(isPlayerAddress('https://www.youtube-nocookie.com/embed/aaaa/../x?')).toBe(false);
  });

  it('goes to theater and back with Escape, and Stop puts the poster back', async () => {
    const { container } = renderNacre(<VideoCard video={bake} playerFor={youtube} />);
    await userEvent.click(screen.getByRole('button', { name: /^Play:/ }));
    const theater = screen.getByRole('button', { name: 'Theater' });
    await userEvent.click(theater);
    const card = container.querySelector('figure');
    expect(card).toHaveAttribute('data-theater');
    expect(screen.getByRole('button', { name: 'Leave theater' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(card).not.toHaveAttribute('data-theater');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('plays from a chapter', async () => {
    const { container } = renderNacre(<VideoCard video={bake} playerFor={youtube} />);
    const chapters = screen.getByRole('list', { name: 'Chapters' });
    await userEvent.click(
      within(chapters).getByRole('button', { name: 'Play from 3:26: Shaping your loaf' }),
    );
    expect(container.querySelector('iframe')?.src).toContain('start=206');
  });

  it('plays one video at a time in the whole chat', async () => {
    const { container } = renderNacre(
      <>
        <VideoCard video={bake} playerFor={youtube} />
        <VideoCard video={boule} playerFor={youtube} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Play: Bake/ }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^Play: How to shape/ }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(container.querySelectorAll('figure')[0]).not.toHaveAttribute('data-playing');
    expect(container.querySelectorAll('figure')[1]).toHaveAttribute('data-playing');
  });

  it('says a live stream in words', () => {
    renderNacre(<VideoCard video={liveBake} playerFor={youtube} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Play: .*, live$/ })).toBeInTheDocument();
  });
});

describe('VideoShelf', () => {
  it('leads with the first, shelves the rest, and swaps one in by keyboard', async () => {
    const { container } = renderNacre(
      <VideoShelf videos={videos} query="sourdough" playerFor={youtube} />,
    );
    expect(screen.getByRole('region', { name: '5 videos for “sourdough”' })).toBeInTheDocument();
    const shelf = screen.getByRole('list', { name: 'More videos' });
    expect(within(shelf).getAllByRole('button')).toHaveLength(4);
    within(shelf)
      .getByRole('button', { name: /^Show: How to shape a boule/ })
      .focus();
    await userEvent.keyboard(' ');
    expect(container.querySelector('figcaption')).toHaveTextContent('How to shape a boule');
    // The old lead waits on the shelf now.
    expect(within(shelf).getByRole('button', { name: /^Show: Bake the perfect/ })).toBeVisible();
    await expectAccessible(container);
  });

  it('plays the chosen one in the lead’s place when the lead was playing', async () => {
    const { container } = renderNacre(<VideoShelf videos={videos} playerFor={youtube} />);
    await userEvent.click(screen.getByRole('button', { name: /^Play: Bake/ }));
    const shelf = screen.getByRole('list', { name: 'More videos' });
    await userEvent.click(within(shelf).getByRole('button', { name: /^Play: How to shape/ }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(container.querySelector('figcaption')).toHaveTextContent('How to shape a boule');
  });

  it('is just the card for one video', () => {
    renderNacre(<VideoShelf videos={videos.slice(0, 1)} playerFor={youtube} />);
    expect(screen.queryByRole('list', { name: 'More videos' })).toBeNull();
  });
});

describe('the words', () => {
  it('says lengths, views and ages', () => {
    expect(lengthWords(713)).toBe('12 minutes');
    expect(lengthWords(3725)).toBe('1 hour 2 minutes');
    expect(lengthWords(45)).toBe('45 seconds');
    expect(viewsWords(1_280_000)).toBe('1.3M views');
    expect(viewsWords(0)).toBe('No views');
    const now = Date.parse('2026-10-08T12:00:00Z');
    expect(publishedWords('2024-03-08T08:30:07-08:00', now)).toBe('2 years ago');
    expect(publishedWords('3 weeks ago', now)).toBe('3 weeks ago');
  });
});

import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { albums, episode, PretendAudio, songs } from './fixtures';
import { MusicCard } from './MusicCard';
import { MusicMiniPlayer } from './MusicMiniPlayer';
import { createMusicPlayer, MusicPlayerContext, type MusicPlayer } from './player';
import { averageTint, clock, spoken } from './tint';

function setup(ui: React.ReactNode, length = 30) {
  const audio = new PretendAudio(length);
  const player = createMusicPlayer(() => audio);
  const view = renderNacre(
    <MusicPlayerContext.Provider value={player}>{ui}</MusicPlayerContext.Provider>,
  );
  return { ...view, audio, player };
}

describe('MusicCard', () => {
  it('plays a preview at a press, and pause folds it back', async () => {
    const tracks = songs();
    const { container, audio } = setup(<MusicCard tracks={tracks} query="pearl divers" />);
    expect(screen.getByRole('region', { name: 'Music: 8 songs for “pearl divers”' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Play Low Sun, High Water' }));
    expect(audio.src).toBe('blob:song');
    expect(audio.paused).toBe(false);
    expect(container.querySelector('[data-state]')).toHaveAttribute('data-state', 'playing');
    await userEvent.click(screen.getByRole('button', { name: 'Pause Low Sun, High Water' }));
    expect(audio.paused).toBe(true);
    await expectAccessible(container);
  });

  it('seeks five seconds with the arrow keys and plays and pauses with Space on the scrubber', async () => {
    const { audio } = setup(<MusicCard tracks={songs().slice(0, 2)} />);
    const play = screen.getByRole('button', { name: 'Play Low Sun, High Water' });
    await userEvent.click(play);
    audio.currentTime = 10;
    await userEvent.keyboard('{ArrowRight}');
    expect(audio.currentTime).toBe(15);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(audio.currentTime).toBe(5);
    const scrubber = screen.getByRole('slider', { name: 'Position in Low Sun, High Water' });
    act(() => scrubber.focus());
    await userEvent.keyboard(' ');
    expect(audio.paused).toBe(true);
    await userEvent.keyboard('{ArrowRight}');
    expect(audio.currentTime).toBe(10);
    await userEvent.keyboard(' ');
    expect(audio.paused).toBe(false);
  });

  it('plays a row from the tracklist, and its number turns into bars', async () => {
    const { container, audio } = setup(<MusicCard tracks={songs()} />);
    const list = screen.getByRole('list', { name: 'All songs' });
    await userEvent.click(within(list).getByRole('button', { name: 'Play Iris by Glasshouse' }));
    expect(audio.src).toBe('blob:song');
    expect(within(list).getByRole('button', { name: 'Pause Iris by Glasshouse' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // The one shown large follows it.
    expect(screen.getByRole('heading', { name: 'Iris' })).toBeVisible();
    expect(container.querySelector('[data-on] [data-playing]')).not.toBeNull();
  });

  it('plays only one thing in the whole chat', async () => {
    const tracks = songs();
    const { player } = setup(
      <>
        <MusicCard tracks={tracks.slice(0, 1)} cardId="a" />
        <MusicCard tracks={tracks.slice(2, 3)} cardId="b" />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Low Sun, High Water' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play Iris' }));
    expect(player.state().track?.title).toBe('Iris');
    expect(screen.getByRole('button', { name: 'Play Low Sun, High Water' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pause Iris' })).toBeVisible();
  });

  it('gives an episode its skips and its speed', async () => {
    const { audio } = setup(<MusicCard tracks={[episode]} />, 2771);
    await userEvent.click(screen.getByRole('button', { name: `Play ${episode.title}` }));
    audio.currentTime = 100;
    await userEvent.click(screen.getByRole('button', { name: 'Ahead 30 seconds' }));
    expect(audio.currentTime).toBe(130);
    await userEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
    expect(audio.currentTime).toBe(115);
    await userEvent.click(screen.getByRole('radio', { name: '1.5 times' }));
    expect(audio.playbackRate).toBe(1.5);
  });

  it('offers the way out for what can’t play here, as safe links', async () => {
    const tracks = [
      ...albums.slice(0, 1),
      {
        ...albums[0],
        id: 'album-x',
        kind: 'album' as const,
        title: '<img src=x onerror=alert(1)>',
        links: { apple: 'javascript:alert(1)' },
      },
    ];
    const { container } = setup(<MusicCard tracks={tracks} />);
    expect(screen.queryByRole('button', { name: /^Play/ })).toBeNull();
    const apple = screen.getByRole('link', { name: /Apple Music/ });
    expect(apple).toHaveAttribute('target', '_blank');
    expect(apple).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(screen.getByRole('button', { name: /^Show <img/ }));
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /Apple Music/ })).toBeNull();
    await expectAccessible(container);
  });

  it('says calmly when it couldn’t be played', async () => {
    const { audio } = setup(<MusicCard tracks={songs().slice(0, 1)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Low Sun, High Water' }));
    act(() => {
      audio.dispatchEvent(new Event('error'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('This preview couldn’t be played.');
  });
});

describe('MusicMiniPlayer', () => {
  async function playing(): Promise<{ player: MusicPlayer; audio: PretendAudio }> {
    const view = setup(
      <>
        <MusicCard tracks={songs().slice(0, 2)} cardId="card" />
        <MusicMiniPlayer />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Low Sun, High Water' }));
    return view;
  }

  it('shows only when the playing card is out of sight, and takes you back', async () => {
    const { player } = await playing();
    expect(screen.queryByRole('group', { name: 'Now playing' })).toBeNull();
    act(() => player.sight('card', false));
    const mini = screen.getByRole('group', { name: 'Now playing' });
    await userEvent.click(within(mini).getByRole('button', { name: 'Pause Low Sun, High Water' }));
    expect(player.state().playing).toBe(false);
    act(() => player.sight('card', true));
    expect(screen.queryByRole('group', { name: 'Now playing' })).toBeNull();
  });

  it('closes, stopping what played', async () => {
    const { player, audio } = await playing();
    act(() => player.sight('card', false));
    const mini = screen.getByRole('group', { name: 'Now playing' });
    await expectAccessible(mini);
    await userEvent.click(within(mini).getByRole('button', { name: 'Stop and close' }));
    expect(audio.paused).toBe(true);
    expect(player.state().track).toBeUndefined();
    expect(screen.queryByRole('group', { name: 'Now playing' })).toBeNull();
  });
});

describe('the player', () => {
  it('plays a card’s songs on, one after another', async () => {
    const audio = new PretendAudio(30);
    const player = createMusicPlayer(() => audio);
    const tracks = songs();
    const [first] = tracks;
    if (first) player.play(first, { card: 'c', queue: tracks });
    audio.dispatchEvent(new Event('ended'));
    expect(player.state().track?.id).toBe(tracks[1]?.id);
    player.previous();
    expect(player.state().track?.id).toBe(tracks[0]?.id);
  });
});

describe('cover colours and clocks', () => {
  it('reads a cover’s colour, vivid pixels first', () => {
    // Three grey pixels and one red one: the tint is red.
    const px = new Uint8ClampedArray([
      128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 230, 30, 30, 255,
    ]);
    expect(averageTint(px)?.glow).toMatch(/^hsl\((?:35\d|[0-9]|1\d) /);
    expect(averageTint(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull();
  });

  it('tells time in figures and in words', () => {
    expect(clock(7)).toBe('0:07');
    expect(clock(3725)).toBe('1:02:05');
    expect(spoken(61)).toBe('1 minute 1 second');
  });
});

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState, type ReactNode } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { albums, episode, episodes, pretendPlayer, shows, songs, tone } from './fixtures';
import { MusicCard, type MusicCardProps } from './MusicCard';
import { MusicMiniPlayer } from './MusicMiniPlayer';
import { MusicPlayerContext, type MusicTrack } from './player';

/** A card on a pretend player, frozen at one moment, so every state can be seen. */
function At({
  tracks,
  index = 0,
  at = 0,
  playing = true,
  rate,
  outOfSight = false,
  children,
}: {
  tracks: MusicTrack[];
  index?: number;
  at?: number;
  playing?: boolean;
  rate?: number;
  outOfSight?: boolean;
  children: ReactNode;
}) {
  const { player } = useMemo(
    () => pretendPlayer({ track: tracks[index], queue: tracks, card: 'story', at, playing, rate }),
    [tracks, index, at, playing, rate],
  );
  if (outOfSight) player.sight('story', false);
  return <MusicPlayerContext.Provider value={player}>{children}</MusicPlayerContext.Provider>;
}

const meta = {
  title: 'Patterns/Chat/Music',
  component: MusicCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Music and podcasts a tool found, played right in the chat. The one shown large has its cover, with a glow in the cover’s own colour (read from the picture on a canvas; the accent until then) that also tints the card’s air, the progress line and the bars. Behind a song’s cover a record peeks out; pressing play slides it out and sets it turning (33⅓), and the cover breathes. The play button folds into pause on a spring (two halves of one shape). Under it, a scrubber with time played and time left in tabular figures: ←/→ seek five seconds, Space plays and pauses. Several results become a tracklist: a row’s number turns into a play glyph on hover and into dancing bars while it plays, and songs play on, one after another. An episode has −15 / +30 and its speed. Only one thing plays in the whole chat; when its card scrolls away, a mini player floats at the foot of the chat (with the panel motion, glint) and takes you back. The system’s media keys and lock screen know what’s playing. Albums, artists and shows don’t play here: their way out (Apple Music, Spotify, YouTube Music) becomes the main thing. Everything in it came from outside and is plain text; links open in a new tab. Reduced motion stills the record, the breath and the bars.',
      },
    },
  },
  args: {
    tracks: songs((i) => tone(30, [220, 247, 262, 196, 175, 233, 208][i])),
    query: 'pearl divers',
  },
  render: (args: MusicCardProps) => <MusicCard {...args} />,
} satisfies Meta<typeof MusicCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press play: a real (made-up) tone plays, on the page's one player. */
export const Playground: Story = {};

export const OneSong: Story = {
  args: { tracks: songs().slice(0, 1), query: 'low sun high water' },
  render: (args) => (
    <At tracks={args.tracks} playing={false}>
      <MusicCard {...args} cardId="story" />
    </At>
  ),
};

export const Playing: Story = {
  render: (args) => (
    <At tracks={args.tracks} index={1} at={11.4}>
      <MusicCard {...args} cardId="story" />
    </At>
  ),
};

export const Paused: Story = {
  render: (args) => (
    <At tracks={args.tracks} index={1} at={21} playing={false}>
      <MusicCard {...args} cardId="story" />
    </At>
  ),
};

export const PodcastEpisode: Story = {
  args: { tracks: [episode], query: 'slow history lighthouse' },
  render: (args) => (
    <At tracks={args.tracks} at={754} rate={1.25}>
      <MusicCard {...args} cardId="story" />
    </At>
  ),
};

export const Episodes: Story = {
  args: { tracks: episodes, query: 'slow history' },
  render: (args) => (
    <At tracks={args.tracks} playing={false}>
      <MusicCard {...args} cardId="story" />
    </At>
  ),
};

/** Nothing to play here: the way out is the main thing. */
export const Albums: Story = {
  args: { tracks: albums, query: 'tidal rooms' },
};

export const Podcasts: Story = {
  args: { tracks: shows, query: 'history podcasts' },
};

export const NoCover: Story = {
  args: { tracks: songs().slice(7), query: 'nobody yet' },
};

export const CouldNotPlay: Story = {
  render: (args) => {
    const { player, audio } = pretendPlayer({
      track: args.tracks[0],
      queue: args.tracks,
      card: 'story',
    });
    audio.dispatchEvent(new Event('error'));
    return (
      <MusicPlayerContext.Provider value={player}>
        <MusicCard {...args} cardId="story" />
      </MusicPlayerContext.Provider>
    );
  },
};

/** What's playing, when its card has scrolled out of sight. */
export const MiniPlayer: Story = {
  render: (args) => (
    <At tracks={args.tracks} index={2} at={9} outOfSight>
      <div style={{ display: 'grid', placeItems: 'center', minBlockSize: 120 }}>
        <MusicMiniPlayer />
      </div>
    </At>
  ),
};

/** In a chat: play, then scroll away, and the mini player comes. */
export const InAChat: Story = {
  render: (args) => {
    const [player] = useState(() => pretendPlayer().player);
    return (
      <MusicPlayerContext.Provider value={player}>
        <div
          style={{
            position: 'relative',
            blockSize: 460,
            maxInlineSize: 640,
            marginInline: 'auto',
            overflow: 'hidden',
            borderRadius: 12,
            boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
          }}
        >
          <div style={{ blockSize: '100%', overflow: 'auto', padding: 16 }}>
            <p>Play me something like the Pearl Divers.</p>
            <MusicCard {...args} cardId="chat" />
            <div style={{ blockSize: 900, paddingBlockStart: 24, color: 'var(--nc-text-muted)' }}>
              Scroll down: the mini player comes when the card is out of sight.
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              insetInline: 0,
              insetBlockEnd: 12,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <MusicMiniPlayer />
          </div>
        </div>
      </MusicPlayerContext.Provider>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Play Low Sun, High Water$/ }));
    await expect(canvas.getByRole('button', { name: /^Pause Low Sun, High Water$/ })).toBeVisible();
  },
};

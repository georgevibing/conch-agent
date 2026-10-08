import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, type ReactNode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { bake, boule, liveBake, StubPlayer, videos } from './fixtures';
import { stopAllVideos } from './nowPlaying';
import { VideoCard } from './VideoCard';
import { VideoShelf } from './VideoShelf';

const stub = (video: (typeof videos)[number], start?: number) => (
  <StubPlayer video={video} start={start} />
);

/** Every story starts with nothing playing. */
function Fresh({ children }: { children: ReactNode }) {
  useEffect(() => stopAllVideos, []);
  return <>{children}</>;
}

const meta = {
  title: 'Patterns/Chat/Video',
  component: VideoShelf,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Videos found for the chat, played right there. At rest a video is a poster: the picture the gateway kept (never a remote image), its length on a chip, and a big soft play button that blooms under the pointer, its pearl halo gathering on a spring. Pressing play (or Enter, Space) makes the site’s player in place, in the same 16:9 box, and the poster fades into it: nothing loads from YouTube or Vimeo before that press, and only one video plays at a time in the whole chat. Playing, the card offers Theater (as wide as the transcript; Escape leaves it), Full screen and Stop; “Open on YouTube” is always there, quietly. Several results: the first leads, the rest wait on a shelf that scrolls sideways and snaps; choosing one moves its picture up into the lead (a shared-element view transition where the browser has them), and if the lead was playing the new one plays. Chapters are moments to play from. Reduced motion and lustre 0 keep it finished and still. In Storybook the site’s player can’t load, so a stand-in shows what playing looks like.',
      },
    },
  },
  args: { videos, query: 'sourdough for beginners', renderPlayer: stub },
  decorators: [
    (Story) => (
      <Fresh>
        <div style={{ maxInlineSize: 760 }}>{Story()}</div>
      </Fresh>
    ),
  ],
} satisfies Meta<typeof VideoShelf>;

export default meta;
type S = StoryObj<typeof meta>;

export const Playground: S = {};

/** One video: the poster, its length, the play button, its channel and age. */
export const One: S = { args: { videos: videos.slice(0, 1), query: undefined } };

/** Pressed play: the player in place of the poster, and Theater, Full screen, Stop. */
export const Playing: S = {
  args: { videos: videos.slice(0, 1), query: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Play: Bake/ }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible());
  },
};

/** Several: a lead and a shelf of the rest. */
export const Shelf: S = {};

/** The lead playing, the shelf under it: choosing one plays it in its place. */
export const ShelfPlaying: S = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Play: Bake/ }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible());
  },
};

/** Theater: as wide as the transcript. Escape leaves it. */
export const Theater: S = {
  decorators: [(Story) => <div style={{ maxInlineSize: 900 }}>{Story()}</div>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Play: Bake/ }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Theater' }));
  },
};

/** No picture came back: a quiet pearl ground with a film glyph. */
export const NoPicture: S = {
  args: {
    videos: videos.slice(1, 3).map((v) => ({ ...v, poster: undefined })),
    query: undefined,
  },
};

/** A live stream says Live in words, not only in red. */
export const Live: S = { args: { videos: [liveBake, bake], query: undefined } };

/** Can't play here (no player for it): the poster stays, Open on YouTube still works. */
export const CantPlay: S = {
  args: { videos: videos.slice(1, 2), query: undefined, renderPlayer: undefined },
};

/** A phone: tap to play, no hover needed for anything. */
export const Phone: S = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [(Story) => <div style={{ maxInlineSize: 360 }}>{Story()}</div>],
};

/** A single card on its own, as `VideoCard`. */
export const Card: S = {
  render: () => <VideoCard video={boule} renderPlayer={stub} />,
};

/** In a chat: the question, the card, a sentence about the best pick. */
export const InChat: S = {
  render: (args) => (
    <MessageList>
      <Message from="user">
        Can you find me a good video on making sourdough? I’m a beginner.
      </Message>
      <VideoShelf {...args} />
      <Message from="assistant">
        <Prose>
          The first one is the best place to start: it goes from feeding the starter to scoring, in
          twelve minutes, with chapters for each step.
        </Prose>
      </Message>
    </MessageList>
  ),
};

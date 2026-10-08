import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { ImageMaking, type ImageMakingProps } from './ImageMaking';
import { secondsLeft } from './time';

/** A stand-in picture: dunes at dusk, drawn as a data URL so stories need no files. */
const dunes = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2440"/><stop offset=".45" stop-color="#7b4a7a"/><stop offset=".72" stop-color="#f08a5d"/><stop offset="1" stop-color="#ffd29a"/></linearGradient>
<radialGradient id="sun" cx=".62" cy=".62" r=".22"><stop offset="0" stop-color="#fff4d6"/><stop offset=".4" stop-color="#ffd08a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd08a" stop-opacity="0"/></radialGradient>
<linearGradient id="d1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c46a4a"/><stop offset="1" stop-color="#5a2a3a"/></linearGradient>
<linearGradient id="d2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8e3f4a"/><stop offset="1" stop-color="#2a1530"/></linearGradient>
</defs>
<rect width="1536" height="1024" fill="url(#sky)"/>
<rect width="1536" height="1024" fill="url(#sun)"/>
<path d="M0 700 C300 600 520 640 760 700 S1200 620 1536 680 V1024 H0Z" fill="url(#d1)"/>
<path d="M0 820 C260 760 600 900 900 820 S1350 760 1536 840 V1024 H0Z" fill="url(#d2)"/>
</svg>`)}`;

const tower = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1365" viewBox="0 0 768 1365">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e1a2b"/><stop offset="1" stop-color="#2f6f8f"/></linearGradient></defs>
<rect width="768" height="1365" fill="url(#s)"/>
<rect x="300" y="300" width="168" height="1065" rx="12" fill="#c9d6df"/>
<rect x="330" y="360" width="108" height="60" rx="6" fill="#ffe8a3"/>
<circle cx="560" cy="220" r="70" fill="#f4f1de"/>
</svg>`)}`;

const prompt =
  'A polished cinematic 3D render of sand dunes at dusk, a low sun behind soft haze, long shadows, warm rose and amber light, 35mm, shallow depth of field.';

const details: ImageMakingProps['details'] = [
  { label: 'Model', value: 'Gemini 2.5 Flash Image' },
  { label: 'Made with', value: 'OpenRouter' },
  { label: 'Size', value: '1536 × 1024' },
  { label: 'Took', value: '28s' },
  { label: 'Cost', value: '$0.04' },
];

const meta = {
  title: 'Patterns/Chat/ImageMaking',
  component: ImageMaking,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A picture being made, then the picture. While it’s made, the frame already has the picture’s shape, and slow pearl light wanders inside it: a turning film, soft shapes, a sheen that crosses now and then, fine grain. How far it got sits in a small pill (a ring that fills, the percent, about how long is left); when it can’t say, the ring just turns. A partial picture shows through, soft. When it’s ready it develops in place, sharpening out of the light as one glint crosses it, then rests as a quiet card: the picture, its name, Look closer, Download, Copy, Change it, and Details (what was asked for, the model, who made it). Not made is a calm line, never a tick. Reduced motion keeps the light still and the percent.',
      },
    },
  },
  args: {
    state: 'making',
    title: 'Dunes at dusk',
    aspect: '3:2',
    progress: 0.42,
    stage: 'generating',
    secondsLeft: 14,
    by: 'OpenAI',
    prompt,
    details,
    src: dunes,
    downloadHref: dunes,
    onOpen: () => {},
    onEdit: () => {},
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof ImageMaking>;

export default meta;
type S = StoryObj<typeof meta>;

export const Playground: S = {};

/** Being made, with a real number from the provider and about how long is left. */
export const Generating: S = {
  render: (args) => {
    const [p, setP] = useState(0.06);
    useEffect(() => {
      const id = setInterval(() => setP((v) => (v >= 0.94 ? 0.06 : v + 0.025)), 500);
      return () => clearInterval(id);
    }, []);
    return (
      <ImageMaking
        {...args}
        state="making"
        progress={p}
        stage={p > 0.9 ? 'finishing' : 'generating'}
        secondsLeft={secondsLeft(p, 2000 + p * 30_000)}
      />
    );
  },
};

/** The provider can't say how far it is: the ring turns, no number. */
export const Indeterminate: S = {
  args: {
    state: 'making',
    progress: undefined,
    stage: undefined,
    secondsLeft: undefined,
    by: undefined,
  },
};

/** About to start (just approved): 0%, “Starting…”. */
export const Starting: S = {
  args: { state: 'making', progress: 0, stage: 'queued', secondsLeft: undefined },
};

/** A partial picture arrived: it shows through, soft, under the sheen. */
export const WithPreview: S = {
  args: { state: 'making', progress: 0.66, preview: dunes, secondsLeft: 6 },
};

/** Changing a picture, tall: the frame takes the portrait shape. */
export const EditingPortrait: S = {
  args: {
    state: 'making',
    editing: true,
    aspect: '9:16',
    title: 'Lighthouse, at night',
    progress: 0.3,
    secondsLeft: 21,
  },
};

/** The moment it lands: made → ready, developing out of the light. Press Again to replay. */
export const Reveal: S = {
  render: (args) => {
    const [run, setRun] = useState(0);
    const [ready, setReady] = useState(false);
    useEffect(() => {
      setReady(false);
      const id = setTimeout(() => setReady(true), 2200);
      return () => clearTimeout(id);
    }, [run]);
    return (
      <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        <ImageMaking
          key={run}
          {...args}
          state={ready ? 'ready' : 'making'}
          progress={ready ? undefined : 0.92}
          stage="finishing"
        />
        <Button size="sm" variant="surface" onClick={() => setRun((r) => r + 1)}>
          Again
        </Button>
      </div>
    );
  },
};

/** Finished, at rest (as after a reload): the picture, its name and what you can do. */
export const Ready: S = {
  args: { state: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Look closer at Dunes at dusk' }),
    ).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Download Dunes at dusk' })).toBeVisible();
  },
};

/** Finished, tall. */
export const ReadyPortrait: S = {
  args: { state: 'ready', aspect: '9:16', title: 'Lighthouse, at night', src: tower },
};

/** It failed: a calm line with the reason, never a red flood. */
export const Failed: S = {
  args: {
    state: 'failed',
    reason: 'OpenRouter is out of credit. Add some in its settings, then ask again.',
  },
};

/** You said no on the approval card: nothing was sent. */
export const Declined: S = { args: { state: 'declined' } };

/** Stopped while it was being made. */
export const Stopped: S = { args: { state: 'stopped' } };

/** Reduced motion: the light holds still, the percent stays. */
export const ReducedMotion: S = {
  decorators: [(Story) => <div data-nacre-motion="reduced">{Story()}</div>],
  args: { state: 'making' },
};

/** On a phone (about 370 px wide): the caption truncates, the actions stay. */
export const Phone: S = {
  decorators: [(Story) => <div style={{ inlineSize: 340 }}>{Story()}</div>],
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      <ImageMaking {...args} state="making" />
      <ImageMaking {...args} state="ready" title="A very long name for dunes at dusk, cinematic" />
      <ImageMaking {...args} state="declined" />
    </div>
  ),
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Toaster } from '../../components/Toast';
import { cardPng } from '../../utils/raster';
import { sampleWeather } from '../Weather/fixtures';
import { WeatherCard } from '../Weather/Weather';
import { CardShare, type CardShareProps, type ShareApp } from './CardShare';

/** The apps a person is usually reachable on, the one they wrote from last first. */
const telegram: ShareApp = { id: 'ch_1', kind: 'telegram', name: 'Telegram', color: '#26A5E4' };
const whatsapp: ShareApp = { id: 'ch_2', kind: 'whatsapp', name: 'WhatsApp', color: '#25D366' };
const slack: ShareApp = { id: 'ch_3', kind: 'slack', name: 'Slack', color: '#4A154B' };
const signal: ShareApp = { id: 'ch_4', kind: 'signal', name: 'Signal', color: '#3A76F0' };
const apps = [telegram, whatsapp, slack, signal];

/** Never finishes: the story stays on "sending". */
const never = () => new Promise<void>(() => {});

const meta = {
  title: 'Patterns/Chat/CardShare',
  component: CardShare,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The share bar every rich card wears in its footer (ADR 0105). Three quiet icon buttons that only say their names when a pointer rests on them or the keyboard reaches them: **Save as image** downloads the PNG this browser drew, **Copy** puts it on the clipboard (and falls back to words where the browser refuses a picture), and **Send** opens the chat apps this person is actually reachable on — the one they wrote from last at the top — then asks the question with the app in it before anything leaves the computer. With no app connected there is no **Send** button at all, rather than one that cannot work. The bar says what happened beside itself, and announces it politely. It knows nothing of chat apps or the gateway: the card passes the list and the callbacks.',
      },
    },
  },
  args: {
    what: 'chart',
    apps,
    onSaveImage: (): Promise<void> => Promise.resolve(),
    onCopy: (): 'image' => 'image',
    onSend: (): Promise<void> => Promise.resolve(),
  },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
} satisfies Meta<typeof CardShare>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: three icons, no words, nothing claiming attention. */
export const Playground: Story = {};

/** The apps, as the press opens them. Telegram is the one they wrote from last. */
export const OpenMenu: Story = { args: { open: true } };

/** The question, with the app in it. Nothing has gone yet. */
export const Confirming: Story = { args: { open: true, confirming: 'ch_1' } };

/** On its way: the press is spent and the button says so. */
export const Sending: Story = {
  args: { doing: { kind: 'sending', app: telegram }, onSend: never },
};

/** It went. A check, then the words fade. */
export const Sent: Story = { args: { doing: { kind: 'sent', app: telegram } } };

/** The picture is on this computer. */
export const Saved: Story = { args: { doing: { kind: 'saved' } } };

/** The browser wouldn’t take a picture, so the words went instead. */
export const CopiedAsText: Story = { args: { doing: { kind: 'copied', as: 'text' } } };

/** It didn’t go, and says why in the sentence the gateway gave. */
export const Failed: Story = {
  args: { doing: { kind: 'failed', message: 'Telegram isn’t connected right now.' } },
};

/** No chat app connected: **Send** isn’t there. Save and Copy still are. */
export const NoAppsConnected: Story = { args: { apps: [] } };

/** With `lustre=0` the material goes flat and nothing else changes. */
export const NoLustre: Story = {
  args: { open: true },
  globals: { lustre: '0' },
};

/**
 * The rasteriser, for real: the forecast on the left, and on the right the
 * PNG this browser made of it (`cardPng`), drawn at 2× and shown at its CSS
 * size. If text, colours or the background ever stopped surviving the export,
 * this story would show it — press **Save as image** and the same bytes go to
 * disk. Its size in kilobytes is written underneath.
 */
export const ExportedPicture: Story = {
  args: { what: 'forecast' },
  parameters: { layout: 'padded' },
  render: (args) => <ExportDemo {...args} />,
};

function ExportDemo(args: Partial<CardShareProps>) {
  const card = useRef<HTMLElement>(null);
  const [png, setPng] = useState<{ url: string; bytes: number } | undefined>();
  const [problem, setProblem] = useState<string>();

  const draw = useCallback(async () => {
    if (!card.current) return;
    try {
      await document.fonts.ready;
      const blob = await cardPng(card.current, { padding: 12 });
      setPng({ url: URL.createObjectURL(blob), bytes: blob.size });
      setProblem(undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    void draw();
  }, [draw]);

  const save = async () => {
    if (!card.current) return;
    const blob = await cardPng(card.current, { padding: 12 });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'forecast.png';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ inlineSize: 'min(480px, 100%)' }}>
        <WeatherCard
          ref={card}
          weather={sampleWeather({ hour: 11, code: 63, codes: [63, 61, 3] })}
          locale="en-GB"
          share={<CardShare {...args} onSaveImage={save} />}
        />
      </div>
      <figure style={{ margin: 0, inlineSize: 'min(480px, 100%)' }}>
        {png ? (
          <img
            src={png.url}
            alt="The forecast card, exported as a PNG"
            style={{ inlineSize: '100%', display: 'block' }}
          />
        ) : (
          <p>{problem ?? 'Drawing…'}</p>
        )}
        <figcaption style={{ fontSize: 12, opacity: 0.7, marginBlockStart: 8 }}>
          {png ? `The exported PNG — ${Math.round(png.bytes / 1024)} kB` : 'No picture yet'}
        </figcaption>
      </figure>
    </div>
  );
}

/** In a card’s footer: the forecast, with the bar beside where the reading came from. */
export const InACardFooter: Story = {
  args: { what: 'forecast' },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 'min(560px, 90vw)' }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <WeatherCard weather={sampleWeather()} locale="en-GB" share={<CardShare {...args} />} />
  ),
};

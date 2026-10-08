import type { Meta, StoryObj } from '@storybook/react-vite';

import { InChat } from '../ToolViews/fixtures';
import { sampleWeather } from './fixtures';
import { WeatherCard } from './Weather';

const meta = {
  title: 'Patterns/Chat/Weather',
  component: WeatherCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The weather, as a card in the chat (ADR 0060 §7). The sky matches the hour and the condition — dawn, day, dusk and night; clear, grey, foggy, snowy, stormy — in soft, opaque OKLCH gradients, with its own drawn art: a sun whose rays turn slowly, drifting clouds, rain, snow, a rare flicker of lightning, fog, stars. Night and storms are dark in either theme. The next day is a line of temperatures over bars of the chance of rain: drag, hover or use the arrow keys and the headline follows with a soft crossfade (the sky too); let go and it springs back to now. The days ahead lie on one shared scale, cool to warm, with now marked on today. Wind, rain, humidity, UV, the air and the sun are tiles with words, never colour alone. Reduced motion stills every part.',
      },
    },
  },
  args: { weather: sampleWeather(), locale: 'en-GB' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WeatherCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A clear afternoon: the sun turns, the line warms toward three o’clock. */
export const ClearDay: Story = {};

/** A clear night: deep blue in either theme, a moon and stars that twinkle. */
export const ClearNight: Story = {
  args: {
    weather: sampleWeather({ hour: 22, minute: 40, code: 0, codes: [0, 0, 1, 1, 2, 1, 0, 0] }),
  },
};

/** Sunrise: lilac above, peach on the horizon. */
export const Dawn: Story = {
  args: { weather: sampleWeather({ hour: 7, minute: 35, code: 1 }) },
};

/** Sunset, partly cloudy. */
export const Dusk: Story = {
  args: { weather: sampleWeather({ hour: 18, minute: 50, code: 2, codes: [2, 1, 0] }) },
};

/** Rain: a grey-blue sky, streaks falling, the bars tall. */
export const Rain: Story = {
  args: {
    weather: sampleWeather({
      place: { name: 'Berlin', region: 'State of Berlin', country: 'Germany' },
      hour: 11,
      code: 63,
      codes: [63, 61, 80, 3, 3, 2, 61, 61],
      low: 9,
      high: 15,
      air: { european: 18, us: 31 },
      uv: 1,
    }),
  },
};

/** Snow, in °F: flakes drift down a cold, pale sky. */
export const Snow: Story = {
  args: {
    weather: sampleWeather({
      place: { name: 'Denver', region: 'Colorado', country: 'United States' },
      units: 'imperial',
      hour: 10,
      code: 73,
      codes: [73, 71, 71, 3, 3, 85],
      low: -6,
      high: -1,
      air: { european: 15, us: 22 },
      uv: 2,
    }),
    locale: 'en-US',
  },
};

/** A thunderstorm, with a warning: dark in either theme, the bolt flickers now and then. */
export const Storm: Story = {
  args: {
    weather: sampleWeather({
      place: { name: 'Miami', region: 'Florida', country: 'United States' },
      units: 'imperial',
      hour: 16,
      code: 95,
      codes: [95, 95, 82, 81, 3, 2],
      low: 24,
      high: 31,
      alerts: [
        { title: 'Severe thunderstorm warning', severity: 'severe', until: '2026-10-08T19:00' },
      ],
      air: { european: 30, us: 58 },
    }),
    locale: 'en-US',
  },
};

/** Overcast: a calm grey, no sun. */
export const Overcast: Story = {
  args: {
    weather: sampleWeather({
      place: { name: 'London', region: 'England', country: 'United Kingdom' },
      hour: 13,
      code: 3,
      codes: [3, 3, 2, 3],
      low: 11,
      high: 16,
      air: { european: 48, us: 82 },
      uv: 2,
    }),
  },
};

/** Fog: milky bands drift across the art and the sky. */
export const Fog: Story = {
  args: {
    weather: sampleWeather({
      place: { name: 'San Francisco', region: 'California', country: 'United States' },
      hour: 8,
      minute: 50,
      code: 45,
      codes: [45, 45, 3, 2, 1, 1, 2, 45],
      low: 12,
      high: 19,
    }),
  },
};

/** Ten days: seven at first, then **Show 10 days**. */
export const TenDays: Story = {
  args: { weather: sampleWeather({ days: 10, code: 2, codes: [2, 1, 3, 2] }) },
};

/** Phone width: the art and the headline tighten, the tiles go two by two, every sixth hour is named. */
export const Phone: Story = {
  args: { weather: sampleWeather({ code: 80, codes: [80, 61, 3, 2], low: 13, high: 19 }) },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 340, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** In the chat: the card is the answer, and the reply is a sentence. */
export const InAChat: Story = {
  render: (args) => (
    <InChat
      ask="Do I need an umbrella in Berlin today?"
      answer="Yes — showers until about 4 PM, then it clears."
    >
      <WeatherCard {...args} />
    </InChat>
  ),
  args: Rain.args,
  decorators: [(Story) => <Story />],
};

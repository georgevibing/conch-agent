import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { IntegrationCard } from '../Integrations/IntegrationCard';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { AppIcon } from './AppIcon';
import { AppMadeBadge } from './AppMadeBadge';
import { samplePictures } from './fixtures';
import { APP_COLORS, APP_GLYPHS } from './glyphs';

const meta = {
  title: 'Patterns/Conch apps/App icon',
  component: AppIcon,
  args: { glyph: 'sprout', color: 'green', size: 'lg', label: 'Plant diary' },
  argTypes: {
    glyph: { control: 'select', options: APP_GLYPHS },
    color: { control: 'select', options: APP_COLORS },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Conch app’s icon (ADR 0061): one of Lucide’s glyphs on one of Nacre’s colours, drawn the way an integration’s logo is — the same tile, corners, glaze and status dot — so an app someone made sits among the brand logos on the Apps page as one of them. White on most colours, a deep glyph of the same hue on amber, yellow and lime. An app may have a picture instead (`src`, ADR 0090): it fades in over the glyph once loaded, so nothing moves, and the glyph stays if it can’t load.',
      },
    },
  },
} satisfies Meta<typeof AppIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const row = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' } as const;

/** Every colour, light and dark. */
export const Colours: Story = {
  render: () => (
    <div style={row}>
      {APP_COLORS.map((color, i) => (
        <AppIcon
          key={color}
          color={color}
          glyph={APP_GLYPHS[(i * 9) % APP_GLYPHS.length] ?? 'sparkles'}
          size="lg"
          label={color}
        />
      ))}
    </div>
  ),
};

/** Every glyph an app may choose, cycling through the colours. */
export const Glyphs: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 2.5rem)', gap: 10 }}>
      {APP_GLYPHS.map((glyph, i) => (
        <AppIcon
          key={glyph}
          glyph={glyph}
          color={APP_COLORS[i % APP_COLORS.length] ?? 'slate'}
          label={glyph}
          title={glyph}
        />
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={row}>
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <AppIcon
          key={size}
          glyph="sprout"
          color="green"
          size={size}
          label={`Plant diary ${size}`}
        />
      ))}
    </div>
  ),
};

/** Among the brand logos: the same tile, so it belongs. */
export const BesideBrands: Story = {
  render: () => (
    <div style={row}>
      <IntegrationLogo brand="notion" name="Notion" size="lg" />
      <AppIcon glyph="sprout" color="green" size="lg" label="Plant diary" />
      <IntegrationLogo brand="github" name="GitHub" size="lg" />
      <AppIcon glyph="coffee" color="amber" size="lg" label="Coffee tab" />
      <IntegrationLogo brand="google-calendar" name="Google Calendar" color="#4285F4" size="lg" />
      <AppIcon glyph="train-front" color="blue" size="lg" label="Is my train late?" status="ok" />
      <IntegrationLogo brand="slack" name="Slack" size="lg" />
      <AppIcon glyph="book-open" color="violet" size="lg" label="Reading list" />
    </div>
  ),
};

/** On the Apps page: a card with its icon and “Made by you”. */
export const OnACard: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))',
        gap: 12,
        maxInlineSize: 900,
      }}
    >
      <IntegrationCard
        variant="connected"
        name="Plant diary"
        app={{ glyph: 'sprout', color: 'green' }}
        badge={<AppMadeBadge kind="made" />}
        state="ok"
        meta="3 tools · used today"
        enabled
        onToggle={fn()}
        onOpen={fn()}
      />
      <IntegrationCard
        variant="connected"
        name="Notion"
        brand="notion"
        state="ok"
        meta="14 tools · used yesterday"
        enabled
        onToggle={fn()}
        onOpen={fn()}
      />
      <IntegrationCard
        variant="connected"
        name="Reading list"
        app={{ glyph: 'book-open', color: 'violet' }}
        badge={<AppMadeBadge kind="community" />}
        state="needs-auth"
        message="Needs your Goodreads key."
        action={{ label: 'Add the key', onClick: fn() }}
        enabled
        onToggle={fn()}
        onOpen={fn()}
      />
      <IntegrationCard
        variant="catalog"
        name="Coffee tab"
        app={{ glyph: 'coffee', color: 'amber' }}
        badge={<AppMadeBadge kind="made" />}
        tagline="Counts what you spend on coffee, week by week"
        onOpen={fn()}
      />
    </div>
  ),
};

/**
 * An app with a picture as its icon (ADR 0090): a logo or a photo from its own
 * folder, in the same tile at every size. A mark with transparent edges sits
 * on porcelain, so it reads in light and dark.
 */
export const Picture: Story = {
  args: { src: samplePictures.sunrise, label: 'Morning walks' },
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={row}>
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <AppIcon
            key={size}
            glyph="sun"
            color="orange"
            src={samplePictures.sunrise}
            size={size}
            label={`Morning walks ${size}`}
          />
        ))}
      </div>
      <div style={row}>
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <AppIcon
            key={size}
            glyph="flower"
            color="pink"
            src={samplePictures.blossom}
            size={size}
            label={`Blossom ${size}`}
          />
        ))}
      </div>
      <div style={row}>
        <IntegrationLogo brand="notion" name="Notion" size="lg" />
        <AppIcon
          glyph="sun"
          color="orange"
          src={samplePictures.sunrise}
          size="lg"
          label="Morning walks"
          status="ok"
        />
        <AppIcon glyph="sprout" color="green" size="lg" label="Plant diary" />
        <AppIcon
          glyph="flower"
          color="pink"
          src={samplePictures.blossom}
          size="lg"
          label="Blossom"
        />
        <IntegrationLogo brand="slack" name="Slack" size="lg" />
      </div>
    </div>
  ),
};

/** A picture that can’t be drawn (gone, damaged): the glyph stays where it was. */
export const PictureThatFails: Story = {
  args: { glyph: 'heart', color: 'pink', src: samplePictures.broken, label: 'Yoga' },
};

/** On the Apps page: a card whose app has a picture. */
export const PictureOnACard: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))',
        gap: 12,
        maxInlineSize: 600,
      }}
    >
      <IntegrationCard
        variant="connected"
        name="Morning walks"
        app={{ glyph: 'sun', color: 'orange', src: samplePictures.sunrise }}
        badge={<AppMadeBadge kind="made" />}
        state="ok"
        meta="2 tools · used today"
        enabled
        onToggle={fn()}
        onOpen={fn()}
      />
      <IntegrationCard
        variant="catalog"
        name="Blossom"
        app={{ glyph: 'flower', color: 'pink', src: samplePictures.blossom }}
        badge={<AppMadeBadge kind="community" />}
        tagline="Tells you what’s flowering near you this week"
        onOpen={fn()}
      />
    </div>
  ),
};

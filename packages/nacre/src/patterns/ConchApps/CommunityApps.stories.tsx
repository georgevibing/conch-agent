import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sparkles } from 'lucide-react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { IntegrationCard } from '../Integrations/IntegrationCard';
import { CommunityApps, CommunityAppTile } from './CommunityApps';
import { community } from './fixtures';

const meta = {
  title: 'Patterns/Conch apps/Community',
  component: CommunityApps,
  args: { apps: community, onLook: fn() },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '**From the community**, under the Apps gallery (ADR 0061): Conch apps people published on GitHub with the topic `conch-app`. A tile says whose it is, what it does and its stars; **Look** opens the preview, which says what it can do before anything is added. One you have says **Added**. When GitHub limits the search or can’t be reached, a quiet note says so, never an error; an empty search offers to make the app instead.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 960 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommunityApps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Found: Story = {};

export const Loading: Story = { args: { apps: [], loading: true } };

/** Nothing for that search: make it instead. */
export const Empty: Story = {
  args: {
    apps: [],
    query: 'pool hours',
    emptyAction: (
      <Button size="sm" variant="soft" leadingIcon={<Sparkles />}>
        Make “pool hours” with Conch
      </Button>
    ),
  },
};

/** GitHub asked us to wait: what's shown is from before. */
export const Limited: Story = { args: { limited: true, apps: community.slice(0, 2) } };

export const LimitedNothingYet: Story = { args: { limited: true, apps: [] } };

export const Offline: Story = { args: { offline: true, apps: [] } };

/** Beside the catalog's tiles, in the gallery. */
export const InTheGallery: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))',
          gap: 12,
        }}
      >
        <IntegrationCard
          variant="catalog"
          name="Notion"
          brand="notion"
          tagline="Search and edit your pages and databases."
          onOpen={fn()}
        />
        <IntegrationCard
          variant="catalog"
          name="Linear"
          brand="linear"
          color="#5E6AD2"
          tagline="Find, create and update issues."
          onOpen={fn()}
        />
        {community[1] && <CommunityAppTile app={community[1]} onLook={fn()} />}
      </div>
      <CommunityApps {...args} />
    </div>
  ),
};

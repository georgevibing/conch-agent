import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import { AgentAvatar } from './AgentAvatar';
import { AgentChange } from './AgentChange';
import { AGENT_AVATAR_ART, AGENT_AVATAR_COLORS } from './presets';

const presets = Object.entries(AGENT_AVATAR_ART).map(([id, art]) => ({ id, ...art }));

/** A made-up portrait, drawn inline so the story never reaches the network. */
const portrait = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#b8d8f4"/><stop offset="1" stop-color="#c99f7f"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="80" cy="64" r="28" fill="#fff" fill-opacity=".85"/><path d="M28 160c4-34 26-52 52-52s48 18 52 52z" fill="#fff" fill-opacity=".85"/></svg>',
)}`;

const meta = {
  title: 'Patterns/Chat/AgentAvatar',
  component: AgentAvatar,
  args: { name: 'Conch', size: 'lg' },
  argTypes: {
    avatar: {
      control: 'select',
      options: [undefined, ...presets.map((p) => p.id), portrait],
    },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "An agent’s face: over its replies, in a list of agents, on its own page. `avatar` is the protocol’s face — `{ kind: 'preset', id, color? }` or `{ kind: 'image', url }` — or, for short, a preset’s id or a picture’s address; without one (or a preset nobody draws) it wears Conch’s mark. The web app draws its own preset artwork with `AgentAvatarArtProvider`. Agents are rounded tiles, people (`Avatar`) are circles, so the two are never mistaken. A picture shows the name’s initial until it has loaded, and keeps it if it can’t. While `active` the mark’s spiral draws itself and light orbits the rim of every look.",
      },
    },
  },
} satisfies Meta<typeof AgentAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/**
 * Every look an agent can wear without a picture, as a picker would offer
 * them: Conch's own mark, and the cast — one porcelain figure each, two eyes
 * with a glint, a smile and a blush, on a glazed tile of its colour.
 */
export const Presets: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, max-content)', gap: 20 }}>
      {presets.map((preset) => (
        <Stack key={preset.id} gap={1.5} align="center">
          <AgentAvatar name={preset.label} avatar={{ kind: 'preset', id: preset.id }} size="xl" />
          <Text size="xs" tone="muted">
            {preset.label}
          </Text>
        </Stack>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      {[undefined, 'owl', 'spark', portrait].map((avatar) => (
        <Stack key={avatar ?? 'mark'} direction="row" gap={3} align="center">
          {(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map((size) => (
            <AgentAvatar key={size} name="Ada" avatar={avatar} size={size} />
          ))}
        </Stack>
      ))}
    </Stack>
  ),
};

/** A picture; one that can't load keeps the name's initial, on the name's own tint. */
export const Pictures: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      <AgentAvatar name="Ada" avatar={portrait} size="xl" />
      <AgentAvatar name="Ada" avatar="/no-such-picture.png" size="xl" />
      <AgentAvatar name="Grace" avatar="/no-such-picture.png" size="xl" />
    </Stack>
  ),
};

/** At work: the mark draws its spiral; every look's rim carries the orbiting light. */
export const Working: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      <AgentAvatar name="Conch" size="xl" active />
      <AgentAvatar name="Scout" avatar="compass" size="xl" active />
      <AgentAvatar name="Ada" avatar={portrait} size="xl" active />
      <AgentAvatar name="Conch" size="xs" active />
    </Stack>
  ),
};

/** Where another agent takes over a chat (`AgentChange`): a quiet line across the column. */
export const TakingOver: Story = {
  render: () => (
    <Stack gap={4} style={{ inlineSize: 560 }}>
      <AgentChange speaker={{ name: 'Atlas', avatar: 'compass' }} from="Juniper" />
      <AgentChange speaker={{ name: 'Ada', avatar: portrait }} />
    </Stack>
  ),
};

/** One character in every colour: the figure is mixed from the tile, so each still looks finished. */
export const Colours: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, max-content)', gap: 16 }}>
      {AGENT_AVATAR_COLORS.map((color) => (
        <AgentAvatar
          key={color}
          name={color}
          avatar={{ kind: 'preset', id: 'fox', color }}
          size="xl"
        />
      ))}
    </div>
  ),
};

/** Small, as beside a reply or on a chat's row: the figures keep their shape, the details fall away. */
export const SmallCast: Story = {
  name: 'Small cast',
  render: () => (
    <Stack gap={3}>
      {(['xs', 'sm', 'md'] as const).map((size) => (
        <Stack key={size} direction="row" gap={2} align="center">
          {presets.map((preset) => (
            <AgentAvatar
              key={preset.id}
              name={preset.label}
              avatar={{ kind: 'preset', id: preset.id }}
              size={size}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  ),
};

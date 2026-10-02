import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { Text } from '../../components/Text';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { Message } from '../Message';
import { Bento } from './Bento';
import { Facts } from './Facts';
import { LogoChip } from './LogoChip';
import { Marquee } from './Marquee';
import { Reveal } from './Reveal';
import { Scene } from './Scene';
import { Stage } from './Stage';
import { Statement } from './Statement';
import { Steady } from './Steady';
import { TextLink } from './TextLink';

const meta = {
  title: 'Patterns/Site',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'What a front page is made of. A `Scene` is one claim beside the picture that proves it; a `Stage` is the porcelain window that picture plays in; a `Bento` holds the smaller ones. `Facts` are counts that are simply true, a `Statement` is the one thing to remember, and a `Marquee` shows many of a kind without a wall of them. Everything surfaces once as it scrolls into view (`Reveal`), and holds still under reduced motion.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 'clamp(20px, 5vw, 64px)', maxInlineSize: 1180, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const chat = (
  <>
    <Message from="user">What changed in the repo this week?</Message>
    <Message from="assistant" author="Conch">
      <Text>Twelve commits: the terminal, two fixes to search, and a new backup format.</Text>
    </Message>
  </>
);

const bar = (
  <>
    <Text as="span" size="sm" weight="medium">
      Claude Code
    </Text>
    <Badge size="sm" tone="neutral" dot>
      Ready
    </Badge>
  </>
);

export const AScene: Story = {
  name: 'Scene',
  render: () => (
    <Scene
      kicker="Providers"
      title={
        <>
          Every provider. <em>One picker.</em>
        </>
      }
      points={['A chat can move between them and keep its thread.', 'Keys can live in 1Password.']}
      stage={
        <Stage label="A question answered in Conch" bar={bar} tide minHeight={280} align="end">
          {chat}
        </Stage>
      }
    >
      <p>Connect as many as you like. Each adds its models to the same list.</p>
    </Scene>
  ),
};

export const SceneFlipped: Story = {
  name: 'Scene · picture first',
  render: () => (
    <Scene
      flip
      kicker="Safe hands"
      title={
        <>
          It asks when it matters. <em>Only then.</em>
        </>
      }
      stage={
        <Stage label="A question answered in Conch" alive minHeight={240} align="end">
          {chat}
        </Stage>
      }
    >
      <p>Spending, sending, deleting, granting trust. Nothing else interrupts you.</p>
    </Scene>
  ),
};

export const AStage: Story = {
  name: 'Stage',
  render: () => (
    <div style={{ display: 'grid', gap: 32, maxInlineSize: 520 }}>
      <Stage label="A question answered in Conch" bar={bar} align="end" minHeight={260}>
        {chat}
      </Stage>
      <Stage label="The same, while it works" alive>
        <Text tone="muted">The rim orbits while something is happening.</Text>
      </Stage>
    </div>
  ),
};

export const ABento: Story = {
  name: 'Bento',
  render: () => (
    <Bento>
      <Bento.Tile
        span={4}
        title="It remembers, in the open"
        text="Small files you can read, edit or delete."
        picture="A memory Conch saved"
      >
        <Text tone="muted">A picture goes here.</Text>
      </Bento.Tile>
      <Bento.Tile index={1} title="Undo" text="Every file it changes can be put back." />
      <Bento.Tile
        index={2}
        span={3}
        title="Show me"
        text="Charts, pages and tables beside the chat."
      />
      <Bento.Tile index={3} span={3} title="Hand it off" text="Send a job to the background." />
    </Bento>
  ),
};

const names = [
  ['telegram', 'Telegram', '#26A5E4'],
  ['discord', 'Discord', '#5865F2'],
  ['slack', 'Slack', '#4A154B'],
  ['whatsapp', 'WhatsApp', '#25D366'],
  ['signal', 'Signal', '#3A76F0'],
  ['matrix', 'Matrix', '#0DBD8B'],
] as const;

const chips = names.map(([brand, name, color]) => (
  <LogoChip
    key={brand}
    logo={<IntegrationLogo brand={brand} name={name} color={color} size="xs" decorative />}
  >
    {name}
  </LogoChip>
));

export const AMarquee: Story = {
  name: 'Marquee',
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <Marquee label="Chat apps" items={chips} />
      <Marquee label="Chat apps, again" items={[...chips].reverse()} reverse seconds={60} />
    </div>
  ),
};

export const Chips: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {chips}
      <LogoChip
        soon
        logo={
          <IntegrationLogo brand="imessage" name="iMessage" color="#34DA50" size="xs" decorative />
        }
      >
        iMessage
      </LogoChip>
    </div>
  ),
};

export const SomeFacts: Story = {
  name: 'Facts',
  render: () => (
    <Facts label="Conch in numbers">
      <Facts.Item value="5" label="providers, at once" />
      <Facts.Item index={1} value="10" label="chat apps to reach it from" />
      <Facts.Item index={2} value="17" label="apps in the gallery" />
      <Facts.Item index={3} value="0" label="accounts to make" />
    </Facts>
  ),
};

export const AStatement: Story = {
  name: 'Statement',
  render: () => (
    <Statement mark={<Pearl size="lg" label={null} />} from="Why it’s called Conch">
      <p>
        In the old story, whoever holds the conch <em>gets to speak.</em>
      </p>
    </Statement>
  ),
};

export const ANote: Story = {
  name: 'Statement · a note',
  render: () => (
    <Statement size="md" variant="quote" from="The person who built it">
      <p>I built this for myself. It’s open source now, so it can be yours too.</p>
    </Statement>
  ),
};

export const Revealed: Story = {
  name: 'Reveal',
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxInlineSize: 420 }}>
      {['First', 'Then this', 'Then this'].map((words, index) => (
        <Reveal key={words} index={index}>
          <Text size="xl">{words}</Text>
        </Reveal>
      ))}
    </div>
  ),
};

export const Links: Story = {
  name: 'TextLink',
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxInlineSize: 480 }}>
      <Text size="lg">
        Treat it like an SSH server, and read <TextLink href="#">how it’s protected</TextLink>{' '}
        before you put it on a network.
      </Text>
      <TextLink href="#" arrow="forward">
        Compare the providers
      </TextLink>
      <TextLink href="#" arrow="away">
        Read the source
      </TextLink>
    </div>
  ),
};

function SteadyExample() {
  const [lines, setLines] = useState(1);
  const all = ['Read the failing test', 'Found the off-by-one', 'Ran the suite: 46 pass'];
  const list = (count: number) => (
    <ol style={{ margin: 0, paddingInlineStart: 20 }}>
      {all.slice(0, count).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
  return (
    <div style={{ display: 'grid', gap: 12, maxInlineSize: 360 }}>
      <Button size="sm" variant="surface" onClick={() => setLines((n) => (n % 3) + 1)}>
        Next moment
      </Button>
      <Steady
        holds={[list(3)]}
        style={{ padding: 12, boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)' }}
      >
        {list(lines)}
      </Steady>
      <Text size="sm" tone="muted">
        This line never moves: the box above is as tall as its last moment from the start.
      </Text>
    </div>
  );
}

export const ASteady: Story = {
  name: 'Steady',
  render: () => <SteadyExample />,
};

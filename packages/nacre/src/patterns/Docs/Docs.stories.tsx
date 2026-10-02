import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookOpen, Brain, CalendarClock, Globe, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { Surface } from '../../components/Surface';
import { Text } from '../../components/Text';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { Message } from '../Message';
import { Prose } from '../Prose';
import { CommandLine } from './CommandLine';
import { Definitions } from './Definitions';
import { DocsHero } from './DocsHero';
import { DocsNav } from './DocsNav';
import { DocsPager } from './DocsPager';
import { DocsToc } from './DocsToc';
import { LinkCard } from './LinkCard';
import { OsMark } from './OsMark';
import { Steps } from './Steps';
import { Tick } from './Tick';

const meta = {
  title: 'Patterns/Docs',
  parameters: {
    docs: {
      description: {
        component:
          'What a set of pages is made of: the contents with one marker that glides to where you are, the headings of the page on a rail, the page before and after, cards that are links, one command ready to copy, reference lists, and steps on a thread. Calm at rest; the only things that move are the two markers, a command typing itself once, and the tide behind the hero.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const pages = {
  'Get started': ['Install', 'Your first chat', 'On your phone'],
  Providers: ['Overview', 'Claude Code', 'Codex', 'On this computer'],
  Reference: ['Command line', 'Configuration'],
};

export const Nav: Story = {
  render: function Render() {
    const [active, setActive] = useState('Your first chat');
    return (
      <div style={{ inlineSize: 240 }}>
        <DocsNav label="Documentation">
          {Object.entries(pages).map(([title, items]) => (
            <DocsNav.Section key={title} title={title}>
              {items.map((item) => (
                <DocsNav.Link
                  key={item}
                  href={`#${item}`}
                  active={item === active}
                  onClick={(event) => {
                    event.preventDefault();
                    setActive(item);
                  }}
                >
                  {item}
                </DocsNav.Link>
              ))}
            </DocsNav.Section>
          ))}
        </DocsNav>
      </div>
    );
  },
};

const headings = [
  { id: 'one-line', text: 'One line', level: 2 },
  { id: 'what-it-does', text: 'What it does', level: 3 },
  { id: 'from-a-checkout', text: 'From a checkout', level: 2 },
  { id: 'update', text: 'Update or remove', level: 2 },
] as const;

export const Toc: Story = {
  render: function Render() {
    const [active, setActive] = useState('what-it-does');
    return (
      // The rail's links are real anchors; here they only move the marker.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div
        style={{ inlineSize: 220 }}
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest('a');
          if (!link) return;
          event.preventDefault();
          setActive(link.getAttribute('href')?.slice(1) ?? '');
        }}
      >
        <DocsToc items={headings} activeId={active} />
      </div>
    );
  },
};

export const Pager: Story = {
  render: () => (
    <div style={{ inlineSize: 'min(640px, 90vw)' }}>
      <DocsPager>
        <DocsPager.Link direction="previous" title="Install" href="#install" />
        <DocsPager.Link direction="next" title="On your phone" href="#phone" />
      </DocsPager>
    </div>
  ),
};

export const PagerFirstPage: Story = {
  name: 'Pager · first page',
  render: () => (
    <div style={{ inlineSize: 'min(640px, 90vw)' }}>
      <DocsPager>
        <DocsPager.Link direction="next" title="Your first chat" href="#first-chat" />
      </DocsPager>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        inlineSize: 'min(860px, 92vw)',
      }}
    >
      <LinkCard
        index={0}
        href="#memory"
        icon={<Brain />}
        title="Memory"
        description="Small Markdown files you can read, edit or delete."
      />
      <LinkCard
        index={1}
        href="#routines"
        icon={<CalendarClock />}
        title="Routines"
        description="Tasks on a schedule you read in plain words."
      />
      <LinkCard
        index={2}
        href="#browser"
        icon={<Globe />}
        title="The browser"
        description="It uses the web for you while you watch."
      />
      <LinkCard
        index={3}
        href="#telegram"
        icon={<IntegrationLogo brand="telegram" name="Telegram" color="#26A5E4" decorative />}
        title="Telegram"
        meta="2 min"
        description="The easiest. Make a bot, paste its key, say hello."
      />
      <LinkCard
        index={4}
        href="https://code.claude.com"
        external
        icon={<Sparkles />}
        title="Claude Code"
        description="Anthropic’s own documentation."
      />
    </div>
  ),
};

export const Command: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, inlineSize: 'min(560px, 90vw)' }}>
      <CommandLine command="pnpm start" />
      <CommandLine
        size="lg"
        typed
        command="curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.sh | sh"
      />
      <CommandLine prompt=">" command="pnpm conch devices approve" />
    </div>
  ),
};

export const Reference: Story = {
  render: () => (
    <div style={{ inlineSize: 'min(720px, 92vw)' }}>
      <Definitions label="Commands">
        <Definitions.Item term="pnpm conch status">
          The security checkup, in plain words, with what to do about each warning.
        </Definitions.Item>
        <Definitions.Item term="pnpm conch password [--generate]">
          Choose a password, or have a strong one made and shown once.
        </Definitions.Item>
        <Definitions.Item term="CONCH_PORT" meta="Unset: 4317, or the next free port">
          Pins the port. A pinned port that’s taken is reported, never swapped.
        </Definitions.Item>
      </Definitions>
    </div>
  ),
};

export const Instructions: Story = {
  render: () => (
    <Prose style={{ inlineSize: 'min(560px, 90vw)' }}>
      <Steps>
        <Steps.Step>
          In Telegram, open <strong>@BotFather</strong> and send <code>/newbot</code>.
        </Steps.Step>
        <Steps.Step>
          Copy the key it replies with, and paste it anywhere on Conch’s page.
        </Steps.Step>
        <Steps.Step title="Say hello">
          Open the link Conch shows. Your first message tells it the bot is yours.
        </Steps.Step>
      </Steps>
    </Prose>
  ),
};

export const Ticks: Story = {
  render: () => (
    <Prose>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Your files</th>
            <th>Offline</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Claude Code</td>
            <td>
              <Tick value />
            </td>
            <td>
              <Tick value={false} />
            </td>
          </tr>
          <tr>
            <td>On this computer</td>
            <td>
              <Tick value={false} />
            </td>
            <td>
              <Tick value />
            </td>
          </tr>
        </tbody>
      </table>
    </Prose>
  ),
};

export const Hero: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ padding: 'clamp(24px, 6vw, 72px)' }}>
      <DocsHero
        eyebrow={
          <>
            <Pearl size="sm" label={null} />
            <span>Conch documentation</span>
            <Badge tone="neutral" size="sm">
              0.2.0
            </Badge>
          </>
        }
        title={
          <>
            Whoever holds the conch <em>gets to speak.</em>
          </>
        }
        lede="A calm home for the AI assistants you choose, running on your own computer."
        actions={
          <>
            <CommandLine
              size="lg"
              typed
              command="curl -fsSL https://conch.example/install.sh | sh"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="lg" leadingIcon={<BookOpen />}>
                Get started
              </Button>
              <Button size="lg" variant="ghost" tone="neutral" leadingIcon={<ShieldCheck />}>
                How it stays safe
              </Button>
            </div>
          </>
        }
        media={
          <Surface elevation={3} lustre radius="xl" padding={5}>
            <Message from="user">What changed in the repo this week?</Message>
            <Message from="assistant" author="Conch">
              <Text>
                Twelve commits: the terminal, two fixes to search, and a new backup format.
              </Text>
            </Message>
          </Surface>
        }
      />
    </div>
  ),
};

export const OsMarks: Story = {
  name: 'OsMark',
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <Text size="lg">
        <OsMark os="macos" /> macOS and <OsMark os="linux" /> Linux
      </Text>
      <Text size="lg">
        <OsMark os="windows" /> Windows
      </Text>
      <Text size="sm" tone="muted">
        Works on <OsMark os="macos" label="macOS" /> <OsMark os="linux" label="Linux" />{' '}
        <OsMark os="windows" label="Windows" />
      </Text>
    </div>
  ),
};

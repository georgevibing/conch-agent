import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Heading } from '../../components/Text';
import { Stack } from '../../components/Stack';
import { brands, notionTools } from './fixtures';
import { IntegrationCard } from './IntegrationCard';
import { IntegrationHandshake, type HandshakePhase } from './IntegrationHandshake';
import { IntegrationIssueCard } from './IntegrationIssueCard';
import { IntegrationLogo } from './IntegrationLogo';
import { IntegrationStatusBadge, type IntegrationStateValue } from './status';
import { ToolPermissionList, type PermissionTool } from './ToolPermissionList';

const meta = {
  title: 'Patterns/Integrations',
  parameters: {
    docs: {
      description: {
        component:
          'The apps Claude can use. Logos are bundled marks on the brand colour — on screen from the first frame, never fetched. Every state an integration can be in has plain words, a colour that isn’t the only signal, and (when it needs you) exactly one button that fixes it.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const states: IntegrationStateValue[] = [
  'ok',
  'checking',
  'connecting',
  'needs-auth',
  'warning',
  'error',
  'off',
];

export const Logos: Story = {
  render: () => (
    <Stack gap={6}>
      <Stack direction="row" gap={3} wrap>
        {brands.map((b) => (
          <IntegrationLogo key={b.id} brand={b.id} name={b.name} color={b.color} size="lg" />
        ))}
        <IntegrationLogo name="Team wiki" size="lg" />
        <IntegrationLogo name="Obsidian vault" size="lg" />
        <IntegrationLogo brand="custom" name="My server" size="lg" />
      </Stack>
      <Stack direction="row" gap={3} align="end">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <IntegrationLogo key={size} brand="linear" name="Linear" color="#5E6AD2" size={size} />
        ))}
      </Stack>
      <Stack direction="row" gap={4}>
        {states.map((s) => (
          <IntegrationLogo key={s} brand="notion" name="Notion" color="#000" size="lg" status={s} />
        ))}
      </Stack>
    </Stack>
  ),
};

export const StatusBadges: Story = {
  render: () => (
    <Stack direction="row" gap={2} wrap>
      {states.map((s) => (
        <IntegrationStatusBadge key={s} state={s} />
      ))}
    </Stack>
  ),
};

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 20rem), 1fr))',
  gap: 12,
  maxWidth: 960,
} as const;

export const ConnectedCards: Story = {
  render: () => (
    <div style={grid}>
      <IntegrationCard
        variant="connected"
        name="Notion"
        brand="notion"
        color="#000"
        state="ok"
        meta="12 tools · used 2 hours ago"
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="GitHub"
        brand="github"
        color="#181717"
        state="needs-auth"
        message="The token was refused. It may have expired — paste a new one."
        action={{ label: 'Paste a new token', onClick: () => {} }}
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Home Assistant"
        brand="home-assistant"
        color="#18BCF2"
        state="error"
        message="homeassistant.local:8123 isn’t answering. Is it running?"
        action={{ label: 'Try again', onClick: () => {} }}
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="1Password"
        brand="1password"
        color="#145FE4"
        state="error"
        message="Needs the 1Password app."
        action={{ label: 'Finish setup', onClick: () => {} }}
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Linear"
        brand="linear"
        color="#5E6AD2"
        state="checking"
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Zapier"
        brand="zapier"
        color="#FF4F00"
        state="warning"
        message="Connected, but it doesn’t offer anything to use yet."
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Sentry"
        brand="sentry"
        color="#362D59"
        state="off"
        enabled={false}
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Canva"
        brand="canva"
        color="#00C4CC"
        state="connecting"
        message="Waiting for you to sign in."
        enabled
      />
    </div>
  ),
};

/**
 * Apps Conch came across in a provider (its settings, a plugin, its account)
 * and brought in, waiting for a first sign-in. An offer, not a problem: said
 * once above them where they came from, then one small tile each with the
 * one button, and a way to say no that appears when you reach for it.
 */
export const FoundApps: Story = {
  render: () => (
    <Stack gap={8} style={{ maxWidth: 960 }}>
      <Stack gap={3}>
        <Stack gap={0.5}>
          <Heading level={2} size="sm" tone="muted">
            Found in Claude Code
          </Heading>
          <span style={{ color: 'var(--nc-text-subtle)', fontSize: 'var(--nc-text-sm)' }}>
            Claude Code already has these. Sign in once, and Conch can use them with every model.
          </span>
        </Stack>
        <div style={grid}>
          <IntegrationCard
            variant="found"
            name="Datadog"
            brand="datadog"
            color="#632CA6"
            tagline="engineering plugin"
            action={{ label: 'Sign in', onClick: () => {} }}
            dismiss={{ label: 'Don’t use Datadog here', onClick: () => {} }}
          />
          <IntegrationCard
            variant="found"
            name="Jira & Confluence"
            brand="atlassian"
            color="#0052CC"
            tagline="engineering plugin"
            action={{ label: 'Sign in', onClick: () => {} }}
            dismiss={{ label: 'Don’t use Jira & Confluence here', onClick: () => {} }}
          />
          <IntegrationCard
            variant="found"
            name="Linear"
            brand="linear"
            color="#5E6AD2"
            tagline="engineering plugin"
            action={{ label: 'Sign in', onClick: () => {}, loading: true }}
            dismiss={{ label: 'Don’t use Linear here', onClick: () => {} }}
          />
          <IntegrationCard
            variant="found"
            name="Team wiki"
            brand="custom"
            tagline="Claude Code settings"
            action={{ label: 'Sign in', onClick: () => {} }}
            dismiss={{ label: 'Don’t use Team wiki here', onClick: () => {} }}
          />
        </div>
      </Stack>
    </Stack>
  ),
};

/**
 * One app, one card (ADR 0052): Slack the assistant uses and talks to you
 * in, a chat app on its own, and a calm next step that isn't a problem — a
 * hello to finish, someone waiting to be let in.
 */
export const OneAppOneCard: Story = {
  render: () => (
    <div style={grid}>
      <IntegrationCard
        variant="connected"
        name="Slack"
        brand="slack"
        color="#4A154B"
        state="ok"
        meta="4 tools · used 5 minutes ago · talks to you here"
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Telegram"
        brand="telegram"
        color="#26A5E4"
        state="ok"
        meta="@adas_conch_bot"
        notice={{
          message: 'Connected. Say hello from Telegram to finish.',
          label: 'Say hello',
          onClick: () => {},
        }}
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Discord"
        brand="discord"
        color="#5865F2"
        state="ok"
        notice={{
          message: '2 people want to talk to you here.',
          label: 'Review',
          onClick: () => {},
        }}
        enabled
        onToggle={() => {}}
      />
      <IntegrationCard
        variant="connected"
        name="Gmail"
        brand="gmail"
        color="#EA4335"
        state="ok"
        meta="3 tools · not used yet · talks to you here"
        enabled
        onToggle={() => {}}
      />
    </div>
  ),
};

export const CatalogTiles: Story = {
  render: () => (
    <div
      style={{ ...grid, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))' }}
    >
      {brands.map((b, i) => (
        <IntegrationCard
          key={b.id}
          variant="catalog"
          name={b.name}
          brand={b.id}
          color={b.color}
          tagline={b.tagline}
          index={i}
          connected={b.id === 'notion'}
          local={b.id === 'browser'}
          note={b.id === 'home-assistant' ? 'Needs your Home Assistant address' : undefined}
          onOpen={() => {}}
        />
      ))}
    </div>
  ),
};

function HandshakeCycle() {
  const phases: HandshakePhase[] = ['idle', 'waiting', 'connected', 'failed'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % phases.length), 2200);
    return () => clearInterval(t);
  });
  return (
    <Stack gap={3} align="center">
      <IntegrationHandshake name="Notion" brand="notion" color="#000" phase={phases[i]} />
      <code>{phases[i]}</code>
    </Stack>
  );
}

export const Handshake: Story = {
  render: () => (
    <Stack gap={8}>
      <Stack direction="row" gap={8} wrap>
        {(['idle', 'waiting', 'connected', 'failed'] as const).map((phase) => (
          <Stack key={phase} gap={2} align="center">
            <IntegrationHandshake name="Linear" brand="linear" color="#5E6AD2" phase={phase} />
            <code>{phase}</code>
          </Stack>
        ))}
      </Stack>
      <HandshakeCycle />
    </Stack>
  ),
};

function Permissions() {
  const [tools, setTools] = useState<PermissionTool[]>(notionTools);
  return (
    <div style={{ maxWidth: 640 }}>
      <ToolPermissionList
        tools={tools}
        policy="ask-writes"
        onChange={(name, policy) =>
          setTools((all) =>
            all.map((t) => (t.name === name ? { ...t, policy: policy ?? undefined } : t)),
          )
        }
      />
    </div>
  );
}

export const ToolPermissions: Story = { render: () => <Permissions /> };

/** A tool that asks every time whatever the policy (saving a Gmail draft): only Ask or Off. */
function AlwaysAsksPermissions() {
  const [tools, setTools] = useState<PermissionTool[]>([
    {
      name: 'google_mail_search',
      title: 'Search your mail',
      description:
        'Finds emails with Gmail’s own search. It says which emails match, not what they say.',
      access: 'read',
    },
    {
      name: 'google_mail_read',
      title: 'Read an email',
      description: 'Reads one email as plain text, with who sent it and a link to it in Gmail.',
      access: 'read',
      policy: 'ask',
    },
    {
      name: 'google_mail_create_draft',
      title: 'Save a draft',
      description:
        'Saves a new email or a reply in your Drafts, for you to send yourself. It never sends, and asks you every time.',
      access: 'write',
      alwaysAsks: true,
    },
  ]);
  return (
    <div style={{ maxWidth: 640 }}>
      <ToolPermissionList
        tools={tools}
        policy="trust"
        onChange={(name, policy) =>
          setTools((all) =>
            all.map((t) => (t.name === name ? { ...t, policy: policy ?? undefined } : t)),
          )
        }
      />
    </div>
  );
}

export const ToolThatAlwaysAsks: Story = { render: () => <AlwaysAsksPermissions /> };

export const IssueInChat: Story = {
  render: () => (
    <Stack gap={3}>
      <IntegrationIssueCard
        name="Notion"
        brand="notion"
        color="#000"
        state="needs-auth"
        message="Sign in again to keep using it."
        onFix={() => {}}
      />
      <IntegrationIssueCard
        name="Home Assistant"
        brand="home-assistant"
        color="#18BCF2"
        state="error"
        message="homeassistant.local:8123 isn’t answering. Is it running?"
        onFix={() => {}}
      />
      <IntegrationIssueCard
        name="Notion"
        brand="notion"
        color="#000"
        state="needs-auth"
        message=""
        resolved
      />
    </Stack>
  ),
};

/**
 * The Apps page (ADR 0052), top to bottom: what's connected, one card per app;
 * what Conch offers, by kind, chat apps among them; and last, what it found in
 * a provider, waiting for a sign-in.
 */
export const Page: Story = {
  render: () => (
    <Stack gap={8} style={{ maxWidth: 960 }}>
      <Stack direction="row" justify="between" align="end">
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Apps
          </Heading>
          <span style={{ color: 'var(--nc-text-muted)' }}>
            Connect your apps once — Conch can use them with every model you pick, and you can talk
            to it from the ones you chat in.
          </span>
        </Stack>
        <Button variant="surface" leadingIcon={<Plus />}>
          Add your own
        </Button>
      </Stack>
      <Stack gap={3}>
        <Heading level={2} size="sm" tone="muted">
          Connected
        </Heading>
        <div style={grid}>
          <IntegrationCard
            variant="connected"
            name="GitHub"
            brand="github"
            color="#181717"
            state="needs-auth"
            message="Sign in again to keep using it."
            action={{ label: 'Reconnect', onClick: () => {} }}
            enabled
            onToggle={() => {}}
          />
          <IntegrationCard
            variant="connected"
            name="Slack"
            brand="slack"
            color="#4A154B"
            state="ok"
            meta="4 tools · used 5 minutes ago · talks to you here"
            enabled
            onToggle={() => {}}
          />
          <IntegrationCard
            variant="connected"
            name="Telegram"
            brand="telegram"
            color="#26A5E4"
            state="ok"
            notice={{
              message: 'Connected. Say hello from Telegram to finish.',
              label: 'Say hello',
              onClick: () => {},
            }}
            enabled
            onToggle={() => {}}
          />
          <IntegrationCard
            variant="connected"
            name="Notion"
            brand="notion"
            color="#000"
            state="ok"
            meta="12 tools · used 2 hours ago"
            enabled
            onToggle={() => {}}
          />
        </div>
      </Stack>
      <Stack gap={3}>
        <Stack direction="row" justify="between" align="center" wrap>
          <Heading level={2} size="sm" tone="muted">
            Add another app
          </Heading>
          <SegmentedControl size="sm" defaultValue="all" aria-label="Show">
            <SegmentedControl.Item value="all">All</SegmentedControl.Item>
            <SegmentedControl.Item value="talk">Talk to me here</SegmentedControl.Item>
            <SegmentedControl.Item value="work">Work</SegmentedControl.Item>
            <SegmentedControl.Item value="developer">Developer</SegmentedControl.Item>
          </SegmentedControl>
        </Stack>
        {[
          { kind: 'Work', ids: ['gmail', 'google-calendar', 'todoist', 'airtable', 'calendly'] },
          {
            kind: 'Talk to me here',
            apps: [
              { id: 'whatsapp', name: 'WhatsApp', color: '#25D366', tagline: 'Message yourself' },
              {
                id: 'discord',
                name: 'Discord',
                color: '#5865F2',
                tagline: 'A private bot of your own',
              },
              { id: 'imessage', name: 'iMessage', color: '#34DA50', tagline: 'Text yourself' },
            ],
          },
          { kind: 'Files', ids: ['google-drive', 'dropbox'] },
          { kind: 'Design', ids: ['canva', 'miro', 'webflow'] },
          { kind: 'Business', ids: ['stripe', 'paypal', 'intercom', 'attio'] },
        ].map((group) => (
          <Stack key={group.kind} gap={2}>
            <Heading level={3} size="xs" tone="subtle">
              {group.kind}
            </Heading>
            <div
              style={{
                ...grid,
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 14.5rem), 1fr))',
              }}
            >
              {(group.apps ?? brands.filter((b) => group.ids?.includes(b.id))).map((b, i) => (
                <IntegrationCard
                  key={b.id}
                  variant="catalog"
                  index={i}
                  name={b.name}
                  brand={b.id}
                  color={b.color}
                  tagline={b.tagline}
                  onOpen={() => {}}
                />
              ))}
            </div>
          </Stack>
        ))}
      </Stack>
      <Stack gap={3}>
        <Stack gap={0.5}>
          <Heading level={2} size="sm" tone="muted">
            Found in Claude Code
          </Heading>
          <span style={{ color: 'var(--nc-text-subtle)', fontSize: 'var(--nc-text-sm)' }}>
            Claude Code already has these. Sign in once, and Conch can use them with every model.
          </span>
        </Stack>
        <div style={grid}>
          <IntegrationCard
            variant="found"
            name="Datadog"
            brand="datadog"
            color="#632CA6"
            tagline="engineering plugin"
            action={{ label: 'Sign in', onClick: () => {} }}
            dismiss={{ label: 'Don’t use Datadog here', onClick: () => {} }}
          />
          <IntegrationCard
            variant="found"
            name="Jira & Confluence"
            brand="atlassian"
            color="#0052CC"
            tagline="engineering plugin"
            action={{ label: 'Sign in', onClick: () => {} }}
            dismiss={{ label: 'Don’t use Jira & Confluence here', onClick: () => {} }}
          />
          <IntegrationCard
            variant="found"
            name="Linear"
            brand="linear"
            color="#5E6AD2"
            tagline="engineering plugin"
            action={{ label: 'Sign in', onClick: () => {}, loading: true }}
            dismiss={{ label: 'Don’t use Linear here', onClick: () => {} }}
          />
          <IntegrationCard
            variant="found"
            name="Team wiki"
            brand="custom"
            tagline="Claude Code settings"
            action={{ label: 'Sign in', onClick: () => {} }}
            dismiss={{ label: 'Don’t use Team wiki here', onClick: () => {} }}
          />
        </div>
      </Stack>
    </Stack>
  ),
};

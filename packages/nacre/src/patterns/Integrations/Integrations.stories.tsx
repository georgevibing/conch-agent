import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
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
          note={
            ['gmail', 'google-calendar', 'google-drive', 'slack'].includes(b.id)
              ? 'Via your Claude account'
              : undefined
          }
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

/** How the pieces compose into the Integrations page. */
export const Page: Story = {
  render: () => (
    <Stack gap={8} style={{ maxWidth: 960 }}>
      <Stack direction="row" justify="between" align="end">
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Integrations
          </Heading>
          <span style={{ color: 'var(--nc-text-muted)' }}>
            Let Claude work with the apps you use.
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
        <Heading level={2} size="sm" tone="muted">
          Add an app
        </Heading>
        <div
          style={{
            ...grid,
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))',
          }}
        >
          {brands.slice(0, 9).map((b, i) => (
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
    </Stack>
  ),
};

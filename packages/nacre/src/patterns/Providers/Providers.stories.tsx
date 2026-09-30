import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { Heading, Text } from '../../components/Text';
import { providers } from './fixtures';
import { ProviderCard, ProviderCaution, ProviderStatusBadge } from './ProviderCard';
import type { ProviderStateValue } from './ProviderCard';
import { SecretField, type SecretSourceValue } from './SecretField';

const meta = {
  title: 'Patterns/Providers',
  parameters: {
    docs: {
      description: {
        component:
          'What powers the assistant. One provider is in use and wears a ring; the rest stay ready. Every state has plain words and, when it needs you, exactly one button. Keys can live on this computer or in 1Password — the same field does both.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const states: ProviderStateValue[] = ['checking', 'not-installed', 'signed-out', 'ready', 'error'];

export const Gallery: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: '40rem' }}>
      {providers.map((provider, index) => (
        <ProviderCard
          key={provider.name}
          {...provider}
          index={index}
          action={
            provider.state === 'ready'
              ? provider.active
                ? { label: 'Check again', onClick: () => {} }
                : { label: 'Make default', onClick: () => {} }
              : provider.state === 'not-installed'
                ? { label: 'How to install', onClick: () => {} }
                : { label: 'Connect', onClick: () => {} }
          }
          secondary={
            provider.state === 'ready' && !provider.active
              ? { label: 'Remove key', onClick: () => {} }
              : undefined
          }
        />
      ))}
    </Stack>
  ),
};

export const States: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: '40rem' }}>
      <Stack direction="row" gap={2} wrap>
        {states.map((state) => (
          <ProviderStatusBadge key={state} state={state} />
        ))}
      </Stack>
      {states.map((state, index) => (
        <ProviderCard
          key={state}
          name="OpenRouter"
          brand="openrouter"
          color="#475569"
          tagline="Hundreds of models, one key"
          state={state}
          index={index}
          message={
            state === 'error' ? 'OpenRouter didn’t answer. Check your connection.' : undefined
          }
          meta={state === 'ready' ? 'OpenRouter · $12.40 left' : undefined}
        />
      ))}
    </Stack>
  ),
};

export const Active: Story = {
  render: () => (
    <Stack gap={4} style={{ maxInlineSize: '40rem' }}>
      <Heading level={3} size="sm" tone="muted">
        The default says so
      </Heading>
      <ProviderCard
        name="Claude Code"
        brand="claude-code"
        color="#D97757"
        tagline="Claude, on this computer"
        state="ready"
        active
        meta="Amazon Bedrock · 2.1.284"
        action={{ label: 'Check again', onClick: () => {} }}
      />
      <ProviderCaution>
        Codex works inside its own sandbox, so Conch can’t ask you before each step.
      </ProviderCaution>
    </Stack>
  ),
};

/**
 * A model on this computer (Ollama). Not set up yet is an invitation, not a
 * problem; waiting for a model says so in its own words (`stateLabel`).
 */
export const OnThisComputer: Story = {
  render: () => {
    const base = {
      name: 'On this computer',
      brand: 'ollama',
      color: '#2F6B5E',
      tagline: 'Private, free, and works offline',
      highlights: ['Private', 'Free', 'Works offline'],
    };
    return (
      <Stack gap={3} style={{ maxInlineSize: '40rem' }}>
        <ProviderCard
          {...base}
          state="not-installed"
          message="Ollama runs the model. It isn’t on this computer yet."
          action={{ label: 'Set up', onClick: () => {} }}
        />
        <ProviderCard
          {...base}
          index={1}
          state="not-installed"
          stateLabel="Needs a model"
          message="Get a model to start chatting. It’s free, and it runs on this computer."
          action={{ label: 'Set up', onClick: () => {} }}
        />
        <ProviderCard
          {...base}
          index={2}
          state="ready"
          meta="Qwen3.5 9B and 1 more · works offline · 0.35.0"
          action={{ label: 'Make default', onClick: () => {} }}
          secondary={{ label: 'Details', onClick: () => {} }}
        />
        <ProviderCaution>
          Slower and less capable than the big cloud models: best for everyday questions, drafts and
          quick jobs.
        </ProviderCaution>
      </Stack>
    );
  },
};

function KeyForm({
  available,
  start = 'conch',
}: {
  available: boolean;
  start?: SecretSourceValue;
}) {
  const [value, setValue] = useState('');
  const [source, setSource] = useState<SecretSourceValue>(start);
  return (
    <SecretField
      label="OpenRouter key"
      value={value}
      onValueChange={setValue}
      source={source}
      onSourceChange={setSource}
      placeholder="sk-or-v1-…"
      help="Create one in OpenRouter’s settings. Usage is billed to that account."
      url="https://openrouter.ai/settings/keys"
      onePassword={{
        available,
        message: 'Install the 1Password command line tool to keep keys in 1Password.',
        installCommand: 'brew install 1password-cli',
        docsUrl: 'https://www.1password.dev/cli/secret-reference-syntax/',
      }}
    />
  );
}

export const Keys: Story = {
  render: () => (
    <Stack gap={8} style={{ maxInlineSize: '32rem' }}>
      <Stack gap={2}>
        <Text size="sm" tone="muted">
          With the 1Password command line tool installed
        </Text>
        <KeyForm available />
      </Stack>
      <Stack gap={2}>
        <Text size="sm" tone="muted">
          Without it — the option explains itself instead of disappearing
        </Text>
        <KeyForm available={false} start="1password" />
      </Stack>
      <Stack gap={2}>
        <Text size="sm" tone="muted">
          Already saved
        </Text>
        <SecretField
          label="Anthropic API key"
          value=""
          onValueChange={() => {}}
          source="1password"
          onSourceChange={() => {}}
          onePassword={{ available: true }}
          saved={{ source: '1password', hint: 'op://Private/Anthropic/credential' }}
        />
      </Stack>
    </Stack>
  ),
};

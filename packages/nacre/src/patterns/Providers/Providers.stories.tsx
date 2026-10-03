import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { Heading, Text } from '../../components/Text';
import { providers } from './fixtures';
import { KeyCatcher, type KeyCandidate, type KeyMatch } from './KeyCatcher';
import { ProviderCard, ProviderCaution, ProviderStatusBadge } from './ProviderCard';
import type { ProviderStateValue } from './ProviderCard';
import { SecretField, type SecretSourceValue } from './SecretField';
import { SignInCode } from './SignInCode';

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
          meta="Qwen3.5 9B and 1 more · works offline · Ollama 0.35.0"
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

/**
 * A provider that signs in with a code (a ChatGPT plan): the code reads at a
 * glance, and one button copies it and opens the page it goes on. Press it and
 * the line underneath says the code is on your clipboard.
 */
export const SignInWithACode: Story = {
  render: () => (
    <Stack gap={8} style={{ maxInlineSize: '40rem' }}>
      <SignInCode code="AXC7-NV0ME" url="https://auth.openai.com/codex/device" />
      <Stack gap={2}>
        <Text size="sm" tone="muted">
          A longer code, in a narrow place: it wraps between its groups
        </Text>
        <div style={{ maxInlineSize: '19rem' }}>
          <SignInCode code="WDJB-MJHT-K7Q2" url="https://example.com/device" />
        </div>
      </Stack>
    </Stack>
  ),
};

const groq: KeyCandidate = { id: 'groq', name: 'Groq', color: '#F55036' };
const deepseek: KeyCandidate = {
  id: 'deepseek',
  name: 'DeepSeek',
  brand: 'deepseek',
  color: '#4D6BFE',
};
const kimi: KeyCandidate = { id: 'moonshot', name: 'Kimi', brand: 'moonshot', color: '#16191E' };
const qwen: KeyCandidate = { id: 'qwen', name: 'Qwen', brand: 'qwen', color: '#615CED' };
const gemini: KeyCandidate = {
  id: 'gemini',
  name: 'Google Gemini',
  brand: 'gemini',
  color: '#3186FF',
};

const mistral: KeyCandidate = {
  id: 'mistral',
  name: 'Mistral',
  brand: 'mistral',
  color: '#FA520F',
};

const recogniseKey = (value: string): KeyMatch =>
  value.startsWith('gsk_')
    ? { candidates: [groq], sure: true }
    : value.startsWith('AIza')
      ? { candidates: [gemini], sure: true }
      : value.startsWith('sk-')
        ? { candidates: [deepseek, kimi, qwen], sure: false }
        : /^[A-Za-z0-9]{32}$/.test(value)
          ? { candidates: [mistral], sure: false }
          : { candidates: [], sure: false };

/**
 * Have a key? Paste it here, or anywhere on the page — Conch knows a key by its
 * prefix and checks it with its provider straight away. Try `gsk_` and 26 more
 * characters (one company's prefix), `sk-` and 26 more (shared by several: it
 * asks), 32 letters and digits (only Mistral's shape, but no prefix: it asks
 * first), or anything else (it offers everyone). A key ending in `0000` is
 * refused.
 */
export const PasteAKey: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <KeyCatcher
        recognise={recogniseKey}
        all={[gemini, groq, deepseek, kimi, mistral, qwen]}
        onConnect={(id, value) =>
          new Promise((resolve, reject) =>
            setTimeout(
              () =>
                value.endsWith('0000')
                  ? reject(new Error(`${id === 'groq' ? 'Groq' : 'It'} refused your key.`))
                  : resolve(),
              1200,
            ),
          )
        }
      />
    </div>
  ),
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

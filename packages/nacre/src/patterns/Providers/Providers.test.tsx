import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { providers } from './fixtures';
import { ProviderCard, providerStateMeta, ProviderStatusBadge } from './ProviderCard';
import { SecretField } from './SecretField';

describe('ProviderCard', () => {
  it('says which provider is in use, and what each one needs', async () => {
    const { container } = renderNacre(
      <>
        {providers.map((provider, index) => (
          <ProviderCard key={provider.name} {...provider} index={index} />
        ))}
      </>,
    );
    const claude = screen.getByRole('article', { name: 'Claude Code' });
    expect(claude).toHaveTextContent('In use');
    expect(claude).toHaveTextContent('Claude Max · ada@example.com · 2.1.284');
    // Codex isn't here yet, and says so rather than looking broken.
    const codex = screen.getByRole('article', { name: 'Codex' });
    expect(codex).toHaveTextContent('Early support');
    expect(codex).toHaveTextContent('Codex isn’t on this computer yet.');
    expect(screen.getByRole('article', { name: 'Anthropic API' })).not.toHaveTextContent('In use');
    await expectAccessible(container);
  });

  it('offers exactly one action, and runs it', async () => {
    const onClick = vi.fn();
    renderNacre(
      <ProviderCard
        name="OpenRouter"
        tagline="Hundreds of models, one key"
        state="signed-out"
        action={{ label: 'Connect', onClick }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('names its state for a screen reader, not just with colour', () => {
    renderNacre(
      <ProviderCard
        name="Codex"
        tagline="OpenAI’s coding agent"
        state="error"
        message="Codex didn’t start."
      />,
    );
    expect(screen.getByRole('article', { name: 'Codex' })).toHaveTextContent(
      'Not working. Codex didn’t start.',
    );
  });

  it('hides what it is good at once it is connected', () => {
    const highlights = ['Every model in one list'];
    const { rerender } = renderNacre(
      <ProviderCard
        name="OpenRouter"
        tagline="One key"
        state="signed-out"
        highlights={highlights}
      />,
    );
    expect(screen.getByText('Every model in one list')).toBeInTheDocument();
    rerender(
      <ProviderCard name="OpenRouter" tagline="One key" state="ready" highlights={highlights} />,
    );
    expect(screen.queryByText('Every model in one list')).toBeNull();
  });
});

describe('ProviderStatusBadge', () => {
  it('uses plain words for every state', () => {
    renderNacre(
      <>
        {Object.keys(providerStateMeta).map((state) => (
          <ProviderStatusBadge key={state} state={state as keyof typeof providerStateMeta} />
        ))}
      </>,
    );
    for (const label of [
      'Looking…',
      'Not on this computer',
      'Needs connecting',
      'Connected',
      'Not working',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('SecretField', () => {
  const base = {
    label: 'OpenRouter key',
    value: '',
    onValueChange: () => {},
    source: 'conch' as const,
    onSourceChange: () => {},
    placeholder: 'sk-or-v1-…',
  };

  it('hides a typed key and lets you reveal it', async () => {
    const onValueChange = vi.fn();
    const { container } = renderNacre(<SecretField {...base} onValueChange={onValueChange} />);
    const input = screen.getByLabelText('OpenRouter key');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.type(input, 'sk');
    expect(onValueChange).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('switches to a 1Password reference, and explains what is stored', async () => {
    const onSourceChange = vi.fn();
    renderNacre(
      <SecretField {...base} onSourceChange={onSourceChange} onePassword={{ available: true }} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '1Password' }));
    expect(onSourceChange).toHaveBeenCalledWith('1password');

    renderNacre(<SecretField {...base} source="1password" onePassword={{ available: true }} />);
    expect(screen.getByText(/keeps the reference, not the key/)).toBeInTheDocument();
    expect(screen.getAllByLabelText('OpenRouter key').at(-1)).toHaveAttribute(
      'placeholder',
      'op://Private/OpenRouter/credential',
    );
  });

  it('says what is missing when 1Password isn’t installed, instead of hiding the option', () => {
    renderNacre(
      <SecretField
        {...base}
        source="1password"
        onePassword={{
          available: false,
          message: 'Install the 1Password command line tool to keep keys in 1Password.',
          installCommand: 'brew install 1password-cli',
        }}
      />,
    );
    expect(
      screen.getByText('Install the 1Password command line tool to keep keys in 1Password.'),
    ).toBeInTheDocument();
    expect(screen.getByText('brew install 1password-cli')).toBeInTheDocument();
  });

  it('describes a saved secret without revealing it', () => {
    renderNacre(<SecretField {...base} saved={{ source: 'conch', hint: '…4f2c' }} />);
    expect(screen.getByText('Saved on this computer, ending 4f2c')).toBeInTheDocument();
  });
});

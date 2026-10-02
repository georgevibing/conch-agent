import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { providers } from './fixtures';
import { ProviderCard, providerStateMeta, ProviderStatusBadge } from './ProviderCard';
import { SecretField } from './SecretField';
import { SignInCode } from './SignInCode';

describe('ProviderCard', () => {
  it('says which provider is the default, and what each one needs', async () => {
    const { container } = renderNacre(
      <>
        {providers.map((provider, index) => (
          <ProviderCard key={provider.name} {...provider} index={index} />
        ))}
      </>,
    );
    const claude = screen.getByRole('article', { name: 'Claude Code' });
    expect(claude).toHaveTextContent('Default');
    expect(claude).toHaveTextContent('Claude Max · ada@example.com · 2.1.284');
    // Codex isn't here yet, and says so rather than looking broken.
    const codex = screen.getByRole('article', { name: 'Codex' });
    expect(codex).toHaveTextContent('Early support');
    expect(codex).toHaveTextContent('Codex isn’t on this computer yet.');
    expect(screen.getByRole('article', { name: 'Anthropic API' })).not.toHaveTextContent('Default');
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

  it('says its state in its own words when the usual ones don’t fit', async () => {
    const { container } = renderNacre(
      <ProviderCard
        name="On this computer"
        brand="ollama"
        color="#2F6B5E"
        tagline="Private, free, and works offline"
        state="not-installed"
        stateLabel="Needs a model"
        message="Get a model to start chatting."
      />,
    );
    const card = screen.getByRole('article', { name: 'On this computer' });
    expect(card).toHaveTextContent('Needs a model. Get a model to start chatting.');
    expect(card).not.toHaveTextContent('Not on this computer');
    await expectAccessible(container);
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

describe('SignInCode', () => {
  const base = { code: 'AXC7-NV0ME', url: 'https://auth.openai.com/codex/device' };

  it('shows the code large, reads it out, and links to the page it goes on', async () => {
    const { container } = renderNacre(<SignInCode {...base} />);
    // One character a tile, in the code's own groups; read aloud as one code.
    expect(
      screen.getByRole('group', { name: 'Sign-in code A X C 7 - N V 0 M E' }),
    ).toHaveTextContent('AXC7NV0ME');
    const open = screen.getByRole('link', { name: 'Copy code and open sign-in page' });
    expect(open).toHaveAttribute('href', base.url);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByText(/Waiting for you to sign in/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('copies the code on the way to the sign-in page, and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderNacre(<SignInCode {...base} />);
    expect(screen.getByText(/The page opens in a new tab/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Copy code and open sign-in page' }));
    expect(writeText).toHaveBeenCalledWith('AXC7-NV0ME');
    expect(
      await screen.findByText(/Code copied. Paste it on the sign-in page/),
    ).toBeInTheDocument();
  });

  it('copies the code alone, for a page that is already open', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderNacre(<SignInCode {...base} />);
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('AXC7-NV0ME');
    expect(await screen.findByText(/Code copied/)).toBeInTheDocument();
  });

  it('says to type the code when the browser won’t copy it', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Not allowed'));
    renderNacre(<SignInCode {...base} />);
    await user.click(screen.getByRole('link', { name: 'Copy code and open sign-in page' }));
    expect(await screen.findByText(/couldn’t be copied. Type it/)).toBeInTheDocument();
  });
});

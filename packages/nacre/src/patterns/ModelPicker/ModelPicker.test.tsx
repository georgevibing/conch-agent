import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { claudeCode, connectedProviders, efforts, onThisComputer } from './fixtures';
import { matchWords, ModelPicker, type ModelPickerProps } from './ModelPicker';
import { ProviderLogo } from './ProviderLogo';

function setup(overrides: Partial<ModelPickerProps> = {}) {
  const props: ModelPickerProps = {
    providers: [claudeCode],
    model: 'opus',
    onModelChange: vi.fn(),
    effort: 'high',
    efforts,
    onEffortChange: vi.fn(),
    fastMode: false,
    fastModeAvailable: true,
    onFastModeChange: vi.fn(),
    isDefault: false,
    onMakeDefault: vi.fn(),
    ...overrides,
  };
  return { props, ...renderNacre(<ModelPicker {...props} />) };
}

describe('ModelPicker', () => {
  it('summarises the selection on the chip', () => {
    setup({ fastMode: true });
    expect(
      screen.getByRole('button', { name: 'Model: Opus 5.5, High thinking, fast mode' }),
    ).toBeInTheDocument();
  });

  it('hides Auto effort from the chip', () => {
    setup({ effort: 'auto' });
    expect(screen.getByRole('button', { name: 'Model: Opus 5.5' })).toBeInTheDocument();
  });

  it('picks models with the keyboard and focuses the current one on open', async () => {
    const { props } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Model:/ }));
    const opus = await screen.findByRole('radio', { name: /Opus 5.5/ });
    expect(opus).toHaveFocus();
    // (jsdom doesn't reproduce Radix's select-on-arrow; the KeyboardSelection story covers it.)
    screen.getByRole('radio', { name: /Haiku/ }).focus();
    await user.keyboard('{Enter}');
    expect(props.onModelChange).toHaveBeenCalledWith('haiku');
  });

  it('changes effort, fast mode and default', async () => {
    const { props } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Model:/ }));
    await user.click(await screen.findByRole('radio', { name: 'Max' }));
    expect(props.onEffortChange).toHaveBeenCalledWith('max');
    await user.click(screen.getByRole('switch', { name: /Fast mode/ }));
    expect(props.onFastModeChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Make this my default' }));
    expect(props.onMakeDefault).toHaveBeenCalled();
  });

  it('disables fast mode when the model lacks it and hides empty effort', async () => {
    setup({ fastModeAvailable: false, efforts: [], isDefault: true });
    await userEvent.click(screen.getByRole('button', { name: /Model:/ }));
    expect(await screen.findByRole('switch', { name: /Fast mode/ })).toBeDisabled();
    expect(screen.queryByRole('group', { name: 'Thinking effort' })).not.toBeInTheDocument();
    expect(screen.getByText('Your default')).toBeInTheDocument();
  });

  it('is accessible when open', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Model:/ }));
    await screen.findByRole('radiogroup', { name: 'Model' });
    await expectAccessible(document.body);
  });
});

describe('ModelPicker secondary models', () => {
  it('tucks secondary models away until expanded', async () => {
    const { props } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Model:/ }));
    expect(screen.queryByRole('radio', { name: /Opus 4.8/ })).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: /More models/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    await user.click(screen.getByRole('radio', { name: /Opus 4.8/ }));
    expect(props.onModelChange).toHaveBeenCalledWith('claude-opus-4-8');
  });

  it('opens expanded when the selected model is secondary', async () => {
    setup({ model: 'claude-opus-4-8' });
    await userEvent.click(screen.getByRole('button', { name: /Model: Opus 4.8/ }));
    expect(await screen.findByRole('radio', { name: /Opus 4.8/ })).toHaveFocus();
    expect(screen.getByRole('button', { name: /More models/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('ProviderLogo', () => {
  it('is decorative unless titled', () => {
    const { container } = renderNacre(
      <>
        <ProviderLogo provider="claude" />
        <ProviderLogo provider="openai" title="OpenAI" />
      </>,
    );
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('draws a model on this computer as the computer', () => {
    renderNacre(<ProviderLogo provider="local" title="On this computer" />);
    const logo = screen.getByRole('img', { name: 'On this computer' });
    expect(logo).toHaveAttribute('data-provider', 'local');
    expect(logo.querySelector('rect')).not.toBeNull();
  });
});

describe('ModelPicker with a model on this computer', () => {
  it('lists local models under their own provider, and picks one', async () => {
    const onModelChange = vi.fn();
    const { container } = setup({
      providers: [claudeCode, onThisComputer],
      model: 'opus',
      onModelChange,
      open: true,
    });
    const group = screen.getByRole('group', { name: 'On this computer' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringContaining('Qwen3.5 9B'),
      expect.stringContaining('Qwen3 4B'),
      expect.stringContaining('Gemma3 1B'),
    ]);
    await userEvent.click(within(group).getByRole('radio', { name: /Qwen3 4B/ }));
    expect(onModelChange).toHaveBeenCalledWith('qwen3:4b-instruct');
    await expectAccessible(container);
  });
});

describe('ModelPicker with every provider', () => {
  const many = () =>
    setup({ providers: connectedProviders, model: 'opus', onModelChange: vi.fn() });

  it('groups every provider and says why one has nothing to offer', async () => {
    many();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Model: Opus 5.5 \(Claude Code\)/ }));
    for (const name of [/^Claude Code/, /^OpenRouter$/, /^Codex$/, /^Anthropic API$/])
      expect(await screen.findByRole('group', { name })).toBeInTheDocument();
    expect(screen.getByText(/Anthropic didn’t answer in time/)).toBeInTheDocument();
  });

  it('finds a model by name across providers, and picks the best hit with Enter', async () => {
    const { props } = many();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Model:/ }));
    await screen.findByRole('radio', { name: /Opus 5.5/ });
    // Typing in the list moves into the search field.
    await user.keyboard('gpt');
    const search = screen.getByRole('searchbox', { name: 'Search models' });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('gpt');
    const list = within(screen.getByRole('radiogroup', { name: 'Model' }));
    const hits = list.getAllByRole('radio').map((r) => r.textContent);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((text) => !/GPT/.test(text ?? ''))).toEqual([]);
    // Secondary ("More models") ones are searched too.
    await user.clear(search);
    await user.type(search, 'free qwen');
    expect(screen.getByRole('radio', { name: /Qwen3 235B \(free\)/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(props.onModelChange).toHaveBeenCalledWith('qwen/qwen3-235b-a22b:free');
  });

  it('clears the search on the first Escape and says when nothing matches', async () => {
    many();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Model:/ }));
    const search = await screen.findByRole('searchbox', { name: 'Search models' });
    await user.type(search, 'zzz');
    expect(screen.getByText('No model matches “zzz”.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(screen.getByRole('radio', { name: /Opus 5.5/ })).toBeInTheDocument();
  });

  it('is accessible while searching', async () => {
    const { container } = many();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Model:/ }));
    await user.type(await screen.findByRole('searchbox', { name: 'Search models' }), 'qwen');
    await expectAccessible(container.ownerDocument.body);
  });

  it('matches every word, case- and accent-insensitively', () => {
    expect(matchWords('Qwen: Qwen3 Coder', 'coder QWEN')).toMatchObject({
      ranges: [
        [0, 4],
        [12, 17],
      ],
    });
    expect(matchWords('Mistral Médium', 'medium')).not.toBeNull();
    expect(matchWords('Opus 5.5', 'sonnet')).toBeNull();
  });
});

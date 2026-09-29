import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { claudeCode, efforts } from './fixtures';
import { ModelPicker, type ModelPickerProps } from './ModelPicker';
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
});

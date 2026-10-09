import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { claudeCode, efforts, modes } from '../ModelPicker/fixtures';
import type { ModeOption } from '../ModePicker/ModePicker';
import { places } from '../WorkPlaces/fixtures';
import { ComposerSettings, type ComposerSettingsProps } from './ComposerSettings';

// The fixtures' modes, whatever they're called today.
function mode(test: (m: ModeOption) => boolean): ModeOption {
  const found = modes.find(test);
  if (!found) throw new Error('The fixtures lack a mode this test needs.');
  return found;
}
const ask = mode((m) => m.value === 'default');
const calmer = mode((m) => m.value !== ask.value && m.tone !== 'danger');
const trusting = mode((m) => m.tone === 'danger');
const named = (label: string) => new RegExp(`^${label}`);

function setup(overrides: Partial<ComposerSettingsProps> = {}) {
  const props: ComposerSettingsProps = {
    providers: [claudeCode],
    model: 'opus',
    onModelChange: vi.fn(),
    efforts,
    effort: 'high',
    onEffortChange: vi.fn(),
    fastMode: false,
    fastModeAvailable: true,
    onFastModeChange: vi.fn(),
    modes,
    mode: ask.value,
    onModeChange: vi.fn(),
    name: 'Pearl',
    folder: { name: 'conch', path: '/home/me/conch', onChoose: vi.fn() },
    isDefault: false,
    onMakeDefault: vi.fn(),
    sheet: false,
    ...overrides,
  };
  return { props, ...renderNacre(<ComposerSettings {...props} />) };
}

describe('ComposerSettings', () => {
  it('reads as the model and the mode, and says everything to a screen reader', () => {
    setup({ fastMode: true });
    const chip = screen.getByRole('button', { name: /^Model: Opus 5\.5/ });
    expect(chip).toHaveTextContent('Opus 5.5');
    expect(chip).toHaveTextContent(ask.label);
    expect(chip).toHaveAccessibleName(
      `Model: Opus 5.5, High thinking, fast mode. Mode: ${ask.label}`,
    );
  });

  it('holds the model, thinking, fast mode, mode and folder in one panel', async () => {
    const { props, container } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Model:/ }));
    expect(await screen.findByRole('radio', { name: /Opus 5\.5/ })).toHaveFocus();
    expect(screen.getByRole('radiogroup', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Thinking effort' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    // Nowhere else to run: no section for it.
    expect(screen.queryByRole('radiogroup', { name: 'Where work runs' })).toBeNull();

    await user.click(screen.getByRole('switch', { name: /Fast mode/ }));
    expect(props.onFastModeChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('radio', { name: named(calmer.label) }));
    expect(props.onModeChange).toHaveBeenCalledWith(calmer.value);
    await user.click(screen.getByRole('button', { name: 'Make this my default' }));
    expect(props.onMakeDefault).toHaveBeenCalled();
    await expectAccessible(container.ownerDocument.body);
  });

  it('leaves fast mode out entirely for a model without it', async () => {
    setup({ fastModeAvailable: false, fastMode: true });
    const user = userEvent.setup();
    const chip = screen.getByRole('button', { name: /^Model:/ });
    expect(chip).not.toHaveAccessibleName(/fast mode/);
    await user.click(chip);
    await screen.findByRole('radiogroup', { name: 'Model' });
    expect(screen.queryByRole('switch', { name: /Fast mode/ })).toBeNull();
  });

  it('opens at the mode when asked to', async () => {
    setup({ open: true, focus: 'mode', onOpenChange: vi.fn() });
    expect(await screen.findByRole('radio', { name: named(ask.label) })).toHaveFocus();
  });

  it('asks again before Full trust', async () => {
    const { props } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Model:/ }));
    await user.click(await screen.findByRole('radio', { name: named(trusting.label) }));
    expect(props.onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/Pearl run anything/);
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(props.onModeChange).toHaveBeenCalledWith(trusting.value);
  });

  it('shows where work runs once there is somewhere else, and on the chip when elsewhere', async () => {
    setup({ place: { options: places, value: 'container', onValueChange: vi.fn() } });
    const user = userEvent.setup();
    const chip = screen.getByRole('button', { name: /^Model:/ });
    expect(chip).toHaveAccessibleName(/Where work runs: Docker$/);
    await user.click(chip);
    expect(await screen.findByRole('radiogroup', { name: 'Where work runs' })).toBeInTheDocument();
  });

  it('closes before choosing another folder', async () => {
    const onOpenChange = vi.fn();
    const { props } = setup({ onOpenChange });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Model:/ }));
    await user.click(
      await screen.findByRole('button', { name: 'Working folder: conch. Choose another' }),
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(props.folder?.onChoose).toHaveBeenCalled();
  });
});

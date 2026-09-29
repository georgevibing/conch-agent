import type { EffortChoice, PermissionMode } from '@conch/protocol';
import { ModelPicker, ModePicker } from '@conch/nacre';

import { useUi } from '../../app/ui';
import { fuzzyMatch } from '../search/fuzzy';
import { availableModes, effortOptions, pickerProviders } from './catalog';
import { modelKey, type useTurnOptions } from './useTurnOptions';

/**
 * The model chip and the mode chip that live in the composer's toolbar. The
 * model chip lists every connected provider's models, searchable by name.
 */
export function ComposerControls({
  turn,
  disabled,
}: {
  turn: ReturnType<typeof useTurnOptions>;
  disabled?: boolean;
}) {
  const picker = useUi((s) => s.picker);
  const setPicker = useUi((s) => s.setPicker);
  const { catalog, capabilities, options, model } = turn;
  const providers = pickerProviders(catalog?.providers ?? [], catalog?.default, modelKey);
  const selected = options.engine ? modelKey(options.engine, model?.id ?? options.model) : '';

  return (
    <>
      <ModelPicker
        providers={providers}
        model={selected}
        onModelChange={turn.choose}
        match={fuzzyMatch}
        effort={options.effort}
        efforts={effortOptions(model)}
        onEffortChange={(effort) => turn.set({ effort: effort as EffortChoice })}
        fastMode={options.fastMode}
        fastModeAvailable={Boolean(model?.supportsFastMode)}
        onFastModeChange={(fastMode) => turn.set({ fastMode })}
        isDefault={turn.isDefault(['model', 'effort', 'fastMode'])}
        onMakeDefault={() => turn.makeDefault(['model', 'effort', 'fastMode'])}
        open={picker === 'model'}
        onOpenChange={(open) => setPicker(open ? 'model' : null)}
        loading={turn.loading}
        disabled={disabled}
      />
      <ModePicker
        options={availableModes(capabilities?.permissionModes).map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          icon: m.icon,
          tone: m.tone,
        }))}
        value={options.permissionMode}
        onValueChange={(mode) => turn.set({ permissionMode: mode as PermissionMode })}
        isDefault={turn.isDefault(['permissionMode'])}
        onMakeDefault={() => turn.makeDefault(['permissionMode'])}
        open={picker === 'mode'}
        onOpenChange={(open) => setPicker(open ? 'mode' : null)}
        disabled={disabled}
      />
    </>
  );
}

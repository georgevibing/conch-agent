import { fuzzyMatch, type EffortChoice, type PermissionMode } from '@conch/protocol';
import { ModelPicker, ModePicker } from '@conch/nacre';

import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';
import { PlaceChip } from '../workplaces/PlaceChip';
import { availableModes, effortOptions, pickerProviders, providerLogo } from './catalog';
import { modelKey, type useTurnOptions } from './useTurnOptions';

/**
 * The model chip and the mode chip that live in the composer's toolbar. The
 * model chip lists every connected provider's models, searchable by name.
 */
export function ComposerControls({
  turn,
  name,
  disabled,
}: {
  turn: ReturnType<typeof useTurnOptions>;
  /** The assistant's name, for the mode picker's warnings. */
  name: string;
  disabled?: boolean;
}) {
  const picker = useUi((s) => s.picker);
  const setPicker = useUi((s) => s.setPicker);
  const { catalog, capabilities, options, model } = turn;
  const { data: list } = useProviders();
  const listed = pickerProviders(
    catalog?.providers ?? [],
    catalog?.default,
    modelKey,
    options.engine,
  );
  const selected = options.engine ? modelKey(options.engine, model?.id ?? options.model) : '';
  // The chat's own provider while it's away: shown as it is, with why, never swapped for another.
  const providers =
    turn.away && options.engine
      ? [
          ...listed,
          {
            id: options.engine,
            label: list?.providers.find((p) => p.id === options.engine)?.name ?? options.engine,
            logo: providerLogo(options.engine),
            message: 'Not ready right now. Sign in or check it in Settings → Providers.',
            models: [{ id: selected, label: options.model }],
          },
        ]
      : listed;

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
        name={name}
      />
      <PlaceChip turn={turn} {...(disabled !== undefined && { disabled })} />
    </>
  );
}

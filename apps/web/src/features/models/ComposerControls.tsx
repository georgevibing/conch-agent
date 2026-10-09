import { fuzzyMatch, type EffortChoice, type PermissionMode } from '@conch/protocol';
import { ComposerSettings, type ComposerSettingsFolder } from '@conch/nacre';

import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';
import { usePlaceChoice } from '../workplaces/PlaceChip';
import { availableModes, effortOptions, pickerProviders, providerLogo } from './catalog';
import { modelKey, type ResolvedTurnOptions, type useTurnOptions } from './useTurnOptions';

/**
 * The composer's one settings chip, "Opus · Auto": the model with its
 * thinking and fast mode, the mode, where the work runs and the folder, in
 * one panel. The model list holds every connected provider's models,
 * searchable by name. `/model`, `/effort` and ⌘K open it at the model;
 * `/mode` opens it at the mode.
 */
export function ComposerControls({
  turn,
  name,
  folder,
  disabled,
}: {
  turn: ReturnType<typeof useTurnOptions>;
  /** The assistant's name, for the mode's warnings. */
  name: string;
  /** The folder the chat works in, and choosing another. */
  folder?: ComposerSettingsFolder;
  disabled?: boolean;
}) {
  const picker = useUi((s) => s.picker);
  const setPicker = useUi((s) => s.setPicker);
  const open = picker !== null;
  const { catalog, capabilities, options, model } = turn;
  const { data: list } = useProviders();
  const place = usePlaceChoice(turn, open);
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
  // Whatever modes the provider has, as the mode words give them.
  const modes = availableModes(capabilities?.permissionModes).map((m) => ({
    value: m.value,
    label: m.label,
    description: m.description,
    icon: m.icon,
    tone: m.tone,
  }));
  // Fast mode is the model's own: only one that says it has it shows the switch.
  const fastModeAvailable = Boolean(model?.supportsFastMode);
  // One Make this my default for what's here.
  const keys: (keyof ResolvedTurnOptions)[] = [
    'model',
    'effort',
    'fastMode',
    'permissionMode',
    ...(place ? (['place'] as const) : []),
  ];

  return (
    <ComposerSettings
      providers={providers}
      model={selected}
      onModelChange={turn.choose}
      match={fuzzyMatch}
      loading={turn.loading}
      effort={options.effort}
      efforts={effortOptions(model)}
      onEffortChange={(effort) => turn.set({ effort: effort as EffortChoice })}
      fastMode={options.fastMode}
      fastModeAvailable={fastModeAvailable}
      onFastModeChange={(fastMode) => turn.set({ fastMode })}
      modes={modes}
      mode={options.permissionMode}
      onModeChange={(mode) => turn.set({ permissionMode: mode as PermissionMode })}
      name={name}
      {...(place && { place })}
      {...(folder && { folder })}
      isDefault={turn.isDefault(keys)}
      onMakeDefault={() => turn.makeDefault(keys)}
      open={open}
      // `/model` and ⌘K open it at the model; `/mode` at the mode.
      focus={picker === 'mode' ? 'mode' : 'model'}
      onOpenChange={(next) => setPicker(next ? (picker ?? 'model') : null)}
      {...(disabled !== undefined && { disabled })}
    />
  );
}

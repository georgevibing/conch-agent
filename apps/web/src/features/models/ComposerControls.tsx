import type { EffortChoice, PermissionMode } from '@conch/protocol';
import { ModelPicker, ModePicker, type ModelProvider } from '@conch/nacre';

import { useUi } from '../../app/ui';
import { availableModes, effortOptions, isSecondaryModel } from './catalog';
import type { useTurnOptions } from './useTurnOptions';

/** The model chip and the mode chip that live in the composer's toolbar. */
export function ComposerControls({
  turn,
  disabled,
}: {
  turn: ReturnType<typeof useTurnOptions>;
  disabled?: boolean;
}) {
  const picker = useUi((s) => s.picker);
  const setPicker = useUi((s) => s.setPicker);
  const { capabilities, options, model } = turn;

  const providers: ModelProvider[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      logo: 'claude',
      models: (capabilities?.models ?? []).map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        secondary: isSecondaryModel(m),
      })),
    },
  ];

  return (
    <>
      <ModelPicker
        providers={providers}
        model={model?.id ?? options.model}
        onModelChange={(id) => turn.set({ model: id })}
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

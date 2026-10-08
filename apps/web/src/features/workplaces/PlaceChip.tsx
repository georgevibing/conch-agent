import type { WorkPlaceId } from '@conch/protocol';
import { WorkPlacePicker } from '@conch/nacre';
import { useState } from 'react';

import { useUi } from '../../app/ui';
import type { useTurnOptions } from '../models/useTurnOptions';
import { useWorkPlaces } from './api';
import { placeOption, placeSetup, runsItsOwn } from './words';

/**
 * Where this chat's work runs (ADR 0106), beside the mode in the composer.
 * Only there once somewhere other than this computer can be chosen (Docker or
 * Podman here, a machine in your SSH settings, the cloud's key), or the chat
 * already runs elsewhere: until then it's one less thing to read.
 */
export function PlaceChip({
  turn,
  disabled,
}: {
  turn: ReturnType<typeof useTurnOptions>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const openSettings = useUi((s) => s.openSettings);
  const quick = useWorkPlaces();
  // Opened: each machine is reached once, so the list says which answer.
  const looked = useWorkPlaces({ look: true, enabled: open });
  const status = (open && looked.data) || quick.data;
  const value = turn.options.place;
  if (!status) return null;
  const elsewhere = status.places.some((p) => p.id !== 'computer' && p.state !== 'needs-setup');
  if (!elsewhere && value === 'computer') return null;

  // A place that needs setting up isn't chosen: its row goes to Settings, to
  // the key's box or what gets Docker or Podman, ready to use.
  const options = status.places.map((place) => {
    const setup = placeSetup(place);
    return placeOption(
      place,
      setup && { label: setup.label, onSetup: () => openSettings('security', setup.focus) },
    );
  });
  // A place that's gone (a machine taken out of your SSH settings) is still shown as chosen.
  if (!options.some((o) => o.value === value))
    options.push({
      value,
      kind: value.startsWith('ssh:') ? 'ssh' : 'computer',
      label: value.replace(/^ssh:/, ''),
      description: 'No longer in your SSH settings.',
      state: 'unavailable',
    });

  return (
    <WorkPlacePicker
      options={options}
      value={value}
      onValueChange={(place) => turn.set({ place: place as WorkPlaceId })}
      isDefault={turn.isDefault(['place'])}
      onMakeDefault={() => turn.makeDefault(['place'])}
      {...(turn.capabilities &&
        !turn.capabilities.places && { note: runsItsOwn(turn.capabilities.label) })}
      open={open}
      onOpenChange={setOpen}
      {...(disabled !== undefined && { disabled })}
    />
  );
}

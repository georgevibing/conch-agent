import type { WorkPlaceOption } from './WorkPlacePicker';

export const places: WorkPlaceOption[] = [
  {
    value: 'computer',
    kind: 'computer',
    label: 'This computer',
    description: 'In the sealed box here: your work folder only, no network, no keys.',
  },
  {
    value: 'container',
    kind: 'container',
    label: 'Docker',
    description:
      'A fresh, locked-down box on this computer. It sees only the work folder; your keys and settings stay out.',
  },
  {
    value: 'ssh:build-box',
    kind: 'ssh',
    label: 'build-box',
    description:
      'A computer you already reach with SSH. The work folder is copied there and back; commands have that machine’s own access.',
  },
  {
    value: 'cloud',
    kind: 'cloud',
    label: 'Daytona',
    description:
      'A sandbox at Daytona that sleeps when idle. The work folder is copied there and back; nothing else leaves.',
  },
];

export const notReady: WorkPlaceOption[] = places.map((p) =>
  p.value === 'container'
    ? {
        ...p,
        label: 'A container',
        state: 'needs-setup',
        message: 'Needs Docker or Podman on this computer.',
      }
    : p.value === 'ssh:build-box'
      ? {
          ...p,
          state: 'unavailable',
          message: 'build-box isn’t answering. It may be asleep or off the network.',
        }
      : p.value === 'cloud'
        ? { ...p, state: 'needs-setup', message: 'Needs a Daytona key. It’s free to start.' }
        : p,
);

/** The places that need setting up, each going where it's set up when pressed. */
export function withSetup(
  options: WorkPlaceOption[],
  onSetup: (place: string) => void,
): WorkPlaceOption[] {
  return options.map((o) =>
    o.state === 'needs-setup'
      ? {
          ...o,
          setup: {
            label: o.kind === 'cloud' ? 'Add a key' : 'Set it up',
            onSetup: () => onSetup(o.value),
          },
        }
      : o,
  );
}

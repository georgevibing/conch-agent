/**
 * Repair everything's look at notifications and the phone's secure address
 * (ADR 0027). Looking changes nothing; a repair looks at Tailscale again, so
 * an address turned on in the terminal shows up.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { Tailscale } from '../network/tailscale';
import type { PushService } from './service';

const GROUP = 'This computer';

export function pushCheck(push: PushService, tailscale: Tailscale): DoctorCheck {
  return {
    id: 'notifications',
    group: GROUP,
    title: 'Notifications',
    async run() {
      const items: DoctorItem[] = [];
      const address = await tailscale.status().catch(() => undefined);
      if (address?.state === 'ready')
        items.push({
          id: 'phone:address',
          group: GROUP,
          title: 'Your phone’s address',
          state: 'ok',
          message: `Your devices reach Conch at ${address.url ?? 'its secure address'}.`,
        });
      else if (address && address.state !== 'missing')
        items.push({
          id: 'phone:address',
          group: GROUP,
          title: 'Your phone’s address',
          state: 'off',
          message: 'Conch has no secure address for your phone yet.',
          action: { kind: 'open', label: 'Set it up', place: 'devices', focus: 'add-device' },
        });

      const { devices } = await push.status(undefined);
      const troubled = devices.filter((d) => d.problem);
      for (const d of troubled)
        items.push({
          id: `notifications:${d.id}`,
          group: GROUP,
          title: `Notifications on ${d.name}`,
          state: 'warning',
          message: `${d.name} didn’t get the last notification: ${d.problem}`,
          action: { kind: 'open', label: 'Open Notifications', place: 'notifications' },
        });
      if (!troubled.length)
        items.push({
          id: 'notifications',
          group: GROUP,
          title: 'Notifications',
          state: devices.length ? 'ok' : 'off',
          message: devices.length
            ? `${devices.length === 1 ? 'One device gets' : `${devices.length} devices get`} notifications.`
            : 'No device gets notifications yet.',
          ...(!devices.length && {
            action: { kind: 'open', label: 'Turn them on', place: 'notifications' },
          }),
        });
      return items;
    },
  };
}

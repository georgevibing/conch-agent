/**
 * Repair everything (agreement 12) for the check-in (ADR 0107): whether it can
 * look at what your standing orders ask about. Repair looks again at once (a
 * sign-in renewed, Gmail back on); what only a person can do is one action.
 */
import { DoctorPlace, type CheckInStatus, type DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';

interface CheckIns {
  status(): Promise<CheckInStatus>;
  look(options?: { now?: boolean }): Promise<void>;
}

const BASE = { id: 'checkin', group: 'Routines', title: 'The check-in' } as const;

function item(status: CheckInStatus, was?: CheckInStatus['state']): DoctorItem[] {
  if (status.state === 'off' || status.state === 'resting') return [];
  if (status.state === 'needs-you') {
    const place = DoctorPlace.safeParse(status.fix?.place);
    return [
      {
        ...BASE,
        state: 'needs-you',
        message: status.message ?? 'It can’t look at what your standing orders ask about.',
        action:
          place.success && status.fix
            ? {
                kind: 'open',
                label: status.fix.label,
                place: place.data,
                ...(status.fix.focus && { focus: status.fix.focus }),
              }
            : { kind: 'open', label: 'Open Routines', place: 'routines' },
      },
    ];
  }
  if (was === 'needs-you') return [{ ...BASE, state: 'fixed', message: 'Looking again.' }];
  return [
    {
      ...BASE,
      state: 'ok',
      message:
        status.state === 'held'
          ? (status.message ?? 'Waiting on what routines may spend.')
          : 'Looking now and then, and nothing’s wrong.',
    },
  ];
}

export function checkInCheck(checkins: CheckIns): DoctorCheck {
  return {
    id: BASE.id,
    group: BASE.group,
    title: BASE.title,
    async run({ repair }) {
      const before = await checkins.status();
      if (!repair || before.state !== 'needs-you') return item(before);
      await checkins.look({ now: true }).catch(() => undefined);
      return item(await checkins.status(), before.state);
    },
  };
}

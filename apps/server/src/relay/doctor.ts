/**
 * The always-on relay in Repair everything (AGENTS.md agreement 12, ADR 0140):
 * nothing set up says nothing; set up, it must answer, with this Conch's key,
 * and say how much waits there. Repair asks again, tells it the addresses
 * again and brings in what it kept.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { RelayService } from './service';

export function relayCheck(relay: RelayService): DoctorCheck {
  const base = { id: 'relay', group: 'Talk to me here', title: 'Always-on relay' };
  const item = (rest: Omit<DoctorItem, 'id' | 'group' | 'title'>): DoctorItem[] => [
    { ...base, ...rest },
  ];
  const open = { kind: 'open', label: 'Open', place: 'channels', focus: 'relay' } as const;
  return {
    ...base,
    async run({ repair }) {
      const before = await relay.view();
      if (before.state === 'off') return [];
      if (before.state === 'pairing')
        return item({
          state: 'info',
          message: before.url
            ? 'Set up, but Conch isn’t using it. Open it to finish.'
            : 'Waiting for the relay to be deployed and its address pasted.',
          action: { ...open, label: 'Finish setup' },
        });
      const url = before.url ?? '';
      const problem = await relay.probe(url);
      if (!problem && repair) await relay.repair().catch(() => undefined);
      const now = await relay.view();
      if (problem)
        return item({
          state: problem.needsYou ? 'needs-you' : 'warning',
          message: problem.message,
          action: open,
          ...(!problem.needsYou && !repair && { repairable: true }),
        });
      const waiting = now.depth ?? 0;
      return item({
        state: repair && before.state !== 'ready' ? 'fixed' : 'ok',
        message: waiting
          ? `Reachable, with this computer’s key. ${waiting} waiting to come in.`
          : 'Reachable, with this computer’s key. Nothing waiting.',
      });
    },
  };
}

import type { DoctorItem } from '@conch/protocol';

import type { Doctor } from '../doctor/service';
import type { AgentStore } from './store';

/**
 * Repair everything looks at the agents too (ADR 0101, working agreement 12):
 * that they read, that one is the default, and that every picture of their
 * own is still there. Repair puts a lost picture back to a preset and lets go
 * of pictures no agent has; it never removes an agent.
 */
export function registerAgentsDoctor(doctor: Doctor, agents: AgentStore) {
  doctor.register({
    id: 'agents',
    group: 'Conch',
    title: 'Your agents',
    async run({ repair }): Promise<DoctorItem[]> {
      const list = await agents.list();
      const before = await agents.check(false);
      const item = (
        state: DoctorItem['state'],
        message: string,
        more?: Pick<DoctorItem, 'action' | 'repairable'>,
      ): DoctorItem[] => [
        { id: 'agents', group: 'Conch', title: 'Your agents', state, message, ...more },
      ];
      const count = list.agents.length;
      const fine = `${count === 1 ? 'Your agent is' : `All ${count} agents are`} ready.`;
      if (!before.missing.length && !before.strays.length) return item('ok', fine);
      if (!repair)
        return item(
          'warning',
          before.missing.length
            ? `${before.missing.length === 1 ? 'An agent’s picture is' : 'Some agents’ pictures are'} missing. Repair gives ${before.missing.length === 1 ? 'it' : 'them'} one of Conch’s.`
            : 'Some pictures no agent uses are still kept. Repair lets them go.',
          { repairable: true },
        );
      await agents.check(true);
      const after = await agents.check(false);
      return after.missing.length || after.strays.length
        ? item(
            'warning',
            'Some agents’ pictures couldn’t be put right. Choose new ones in Agents.',
            {
              action: { kind: 'open', label: 'Open Agents', place: 'agents' },
            },
          )
        : item(
            'fixed',
            before.missing.length
              ? `${before.missing.length === 1 ? 'An agent’s picture was' : 'Some agents’ pictures were'} missing, so Conch gave ${before.missing.length === 1 ? 'it' : 'them'} one of its own.`
              : 'Conch let go of pictures no agent uses.',
          );
    },
  });
}

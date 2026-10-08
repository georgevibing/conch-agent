import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { OutsideAgents } from './outside';

/**
 * Repair everything looks at your outside agents (ADR 0112, working agreement
 * 12): that the list reads, and whether each one answered last time. Repair
 * reads the card of each that didn't again, follows it if it moved on the same
 * host, and clears what has passed. It never removes one: only you do.
 */
export function outsideCheck(outside: OutsideAgents): DoctorCheck {
  const item = (
    state: DoctorItem['state'],
    message: string,
    more?: Pick<DoctorItem, 'action' | 'repairable'>,
  ): DoctorItem[] => [
    { id: 'outside-agents', group: 'Conch', title: 'Outside agents', state, message, ...more },
  ];
  return {
    id: 'outside-agents',
    group: 'Conch',
    title: 'Outside agents',
    async run({ repair }): Promise<DoctorItem[]> {
      const agents = await outside.list();
      if (!agents.length) return [];
      const troubled = agents.filter((a) => a.problem);
      if (!troubled.length)
        return item(
          'ok',
          agents.length === 1 ? `${agents[0]?.name} is ready.` : `All ${agents.length} are ready.`,
        );
      const names = troubled.map((a) => a.name).join(', ');
      if (!repair)
        return item(
          'warning',
          `${names} didn’t answer last time. Repair reads ${troubled.length === 1 ? 'its' : 'their'} card again.`,
          { repairable: true },
        );
      const healed: string[] = [];
      for (const agent of troubled) if (await outside.refresh(agent.id)) healed.push(agent.name);
      const still = troubled.filter((a) => !healed.includes(a.name));
      if (!still.length)
        return item('fixed', `${healed.join(', ')} answered again, so Conch carried on with it.`);
      return item(
        'warning',
        `${still.map((a) => a.name).join(', ')} still can’t be reached. Check ${still.length === 1 ? 'it’s' : 'they’re'} running, or paste the address again in Agents.`,
        { action: { kind: 'open', label: 'Open Agents', place: 'agents' } },
      );
    },
  };
}

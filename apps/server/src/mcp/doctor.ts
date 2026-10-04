/** Repair everything's look at the apps paired with Conch (ADR 0073). */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { McpPairing } from './pairing';

const GROUP = 'Other apps';

export function mcpCheck(pairing: McpPairing): DoctorCheck {
  return {
    id: 'mcp',
    group: GROUP,
    title: 'Other apps using Conch',
    async run({ repair }) {
      const items: DoctorItem[] = [];
      if (repair)
        for (const [i, message] of (await pairing.heal()).entries())
          items.push({
            id: `mcp:fixed:${i}`,
            group: GROUP,
            title: 'Other apps using Conch',
            state: 'fixed',
            message,
          });
      const { clients, targets } = await pairing.overview();
      if (!clients.length) return items;
      for (const target of targets) {
        const paired = clients.filter((c) => c.app === target.app);
        if (!paired.length || target.connected) continue;
        items.push({
          id: `mcp:${target.app}`,
          group: GROUP,
          title: target.name,
          state: 'warning',
          message: target.found
            ? `${target.name}’s settings no longer start Conch, so it can’t reach it. Connect it again.`
            : `${target.name} isn’t on this computer any more. Remove it, or install it again and connect it.`,
          action: { kind: 'open', label: 'Open Other apps', place: 'other-apps' },
        });
      }
      if (!items.some((item) => item.state !== 'fixed'))
        items.push({
          id: 'mcp',
          group: GROUP,
          title: 'Other apps using Conch',
          state: 'ok',
          message:
            clients.length === 1
              ? `${clients[0]?.name} can use Conch.`
              : `${clients.length} apps can use Conch.`,
        });
      return items;
    },
  };
}

import type { Integration } from '@conch/protocol';

import { IntegrationError, type HostedApps } from './service';

/**
 * Every family of Conch's own apps as one (ADR 0052): Google's (Gmail,
 * Calendar, Drive) and Slack. `IntegrationService` lists, opens, switches,
 * checks and removes them all the same way, whichever keeps them.
 */
export function hostedApps(...families: HostedApps[]): HostedApps {
  const of = (id: string) => {
    const family = families.find((f) => f.owns(id));
    if (!family) throw new IntegrationError('not-found', 'Integration not found.');
    return family;
  };
  return {
    owns: (id) => families.some((f) => f.owns(id)),
    async list(): Promise<Integration[]> {
      const lists = await Promise.all(families.map((f) => f.list().catch(() => [])));
      return lists.flat();
    },
    get: (id) => of(id).get(id),
    update: (id, patch) => of(id).update(id, patch),
    remove: (id) => of(id).remove(id),
    check: (id) => of(id).check(id),
    decide(toolName) {
      for (const family of families) {
        const decision = family.decide(toolName);
        if (decision) return decision;
      }
      return undefined;
    },
    async promptLines() {
      const all = await Promise.all(
        families.map((f) => f.promptLines().catch(() => ({ working: [], broken: [] }))),
      );
      return {
        working: all.flatMap((lines) => lines.working),
        broken: all.flatMap((lines) => lines.broken),
      };
    },
  };
}

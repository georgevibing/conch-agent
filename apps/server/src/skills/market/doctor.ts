/** Repair everything's look at Discover (ADR 0077). */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../../doctor/service';
import type { SkillMarket } from './service';

const GROUP = 'Skills';
const TITLE = 'Skills you added from Discover';

export function marketCheck(market: Pick<SkillMarket, 'health' | 'states'>): DoctorCheck {
  return {
    id: 'skill-market',
    group: GROUP,
    title: TITLE,
    async run({ repair }) {
      const { missing, swept } = await market.health(repair);
      const items: DoctorItem[] = [];
      const item = (id: string, state: DoctorItem['state'], message: string) =>
        items.push({ id: `skill-market:${id}`, group: GROUP, title: TITLE, state, message });
      if (missing.length)
        item(
          'missing',
          repair ? 'fixed' : 'warning',
          repair
            ? `Forgot ${missing.length === 1 ? 'a skill' : `${missing.length} skills`} whose folder was gone.`
            : `${missing.length === 1 ? 'A skill you added is' : `${missing.length} skills you added are`} missing from this computer. Repair forgets ${missing.length === 1 ? 'it' : 'them'}; add again from Discover.`,
        );
      if (swept)
        item('staging', 'fixed', 'Cleared skills downloaded for a look that nobody added.');
      // A place that didn't answer is said quietly: what's shown comes from before, and it heals itself.
      const away = market.states().filter((s) => s.state !== 'ok');
      if (away.length)
        item(
          'sources',
          'ok',
          `${away.map((s) => s.label).join(' and ')} didn’t answer last time, so Discover showed what it found before.`,
        );
      return items;
    },
  };
}

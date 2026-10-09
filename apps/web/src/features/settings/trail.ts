import { ImportSourceId } from '@conch/protocol';

import { useAgents } from '../agents/api';
import { useImportStatus } from '../import/api';
import { useProviders } from '../providers/queries';
import { SERVER_TILE } from '../providers/words';
import { MEMORY_ALL, type SettingsTab } from './paths';

const COME_HOME_NAMES: Record<ImportSourceId, string> = { openclaw: 'OpenClaw', hermes: 'Hermes' };

/**
 * The name of the page inside a place that an address shows — Settings →
 * Memory → **Memories**, Settings → Providers → **Mistral** — or
 * nothing when it shows the place itself. Some items only bring a section of
 * the place into view (`/settings/health/backup`); they aren't pages, and
 * have no step of their own in the trail.
 */
export function usePageInside(tab: SettingsTab | null, item: string | undefined) {
  const provider = tab === 'providers' && item !== undefined && item !== SERVER_TILE.id;
  const from =
    tab === 'memory' && item?.startsWith('from-')
      ? ImportSourceId.safeParse(item.slice(5))
      : undefined;
  // Asked for only when a page needs its name; the place showing it asks for the same.
  const providers = useProviders(provider);
  const imports = useImportStatus(Boolean(from?.success));
  const { data: agents } = useAgents();
  if (!item) return undefined;
  if (tab === 'agents') return agents?.agents.find((a) => a.id === item)?.name;
  if (tab === 'memory') {
    if (item === MEMORY_ALL) return 'Memories';
    if (from?.success) {
      const name =
        imports.data?.sources.find((s) => s.id === from.data)?.label ?? COME_HOME_NAMES[from.data];
      return `From ${name}`;
    }
    return undefined;
  }
  if (tab === 'providers') {
    if (item === SERVER_TILE.id) return 'Add a server';
    return providers.data?.providers.find((p) => p.id === item)?.name;
  }
  return undefined;
}

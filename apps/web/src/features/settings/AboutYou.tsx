import type { Profile } from '@conch/protocol';

import { useAppState } from '../../api/queries';
import { MemoryTab } from '../memory/MemoryTab';

/**
 * About you lives at the top of Memory now (What Conch knows). An old
 * address that still opens this place shows the same page.
 */
export function AboutYou(_props: { initial: Profile }) {
  const { data: app } = useAppState();
  if (!app) return null;
  return (
    <MemoryTab autoMemory={app.preferences.autoMemory} tidyMemory={app.preferences.tidyMemory} />
  );
}

import { UsageNotice, headline } from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';

/**
 * Speaks up above the composer only when a limit is close or reached. Dismissing
 * hides it until things get worse (e.g. warning → critical → used up).
 */
export function UsageComposerNotice() {
  const { data: app } = useAppState();
  const { data: usage } = useUsage(app?.engine.state === 'ready');
  const setUsageOpen = useUi((s) => s.setUsageOpen);
  const [dismissed, setDismissed] = useState<string>();
  if (!usage || usage.kind === 'unknown') return null;
  const level = `${headline(usage).severity}:${usage.blocked ? 'blocked' : ''}`;
  if (dismissed === level) return null;
  return (
    <UsageNotice
      value={usage}
      onOpen={() => setUsageOpen(true)}
      onDismiss={() => setDismissed(level)}
    />
  );
}

import { UsageNotice, headline } from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';

/**
 * Speaks up above the composer only when a limit is close or reached. Dismissing
 * hides it until things get worse (e.g. warning → critical → used up). At the
 * limit, it says who carries on when you chose someone (ADR 0023).
 */
export function UsageComposerNotice() {
  const { data: app } = useAppState();
  const { data: usage } = useUsage(app?.engine.state === 'ready');
  const { data: providers } = useProviders();
  const setUsageOpen = useUi((s) => s.setUsageOpen);
  const [dismissed, setDismissed] = useState<string>();
  if (!usage || usage.kind === 'unknown') return null;
  const level = `${headline(usage).severity}:${usage.blocked ? 'blocked' : ''}`;
  if (dismissed === level) return null;
  const pick = app?.preferences.limitFallback;
  const carryOn = providers?.providers.find((p) => p.id === pick && p.ready && !p.active)?.name;
  return (
    <UsageNotice
      value={usage}
      carryOn={carryOn}
      onOpen={() => setUsageOpen(true)}
      onDismiss={() => setDismissed(level)}
    />
  );
}

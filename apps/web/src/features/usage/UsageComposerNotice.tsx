import type { EngineId } from '@conch/protocol';
import { UsageNotice, headline } from '@conch/nacre';
import { useState } from 'react';

import { useAppState, useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';

/**
 * Speaks up above the composer only when the limit of the provider answering
 * this chat is close or reached. Dismissing hides it until things get worse
 * (e.g. warning → critical → used up). At the limit, it says who carries on
 * when you chose someone (ADR 0023).
 */
export function UsageComposerNotice({ engine }: { engine: EngineId | undefined }) {
  const { data: app } = useAppState();
  const { data: providers } = useProviders();
  const ready = Boolean(providers?.providers.find((p) => p.id === engine)?.ready);
  const { data: usage } = useUsage(engine, ready);
  const setUsageOpen = useUi((s) => s.setUsageOpen);
  const [dismissed, setDismissed] = useState<string>();
  if (!usage || usage.kind === 'unknown' || usage.engine !== engine) return null;
  const level = `${engine}:${headline(usage).severity}:${usage.blocked ? 'blocked' : ''}`;
  if (dismissed === level) return null;
  const pick = app?.preferences.limitFallback;
  const carryOn = providers?.providers.find(
    (p) => p.id === pick && p.ready && p.id !== engine,
  )?.name;
  return (
    <UsageNotice
      value={usage}
      carryOn={carryOn}
      onOpen={() => setUsageOpen(true)}
      onDismiss={() => setDismissed(level)}
    />
  );
}

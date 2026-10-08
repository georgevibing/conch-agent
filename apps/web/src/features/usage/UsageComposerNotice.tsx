import type { EngineId, PutAwayLimit } from '@conch/protocol';
import { UsageNotice } from '@conch/nacre';
import { useEffect, useRef } from 'react';

import { useAppState, useUpdateSettings, useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';
import { isPutAway, limitInView, putAway, rearm } from './putAway';

const NONE: never[] = [];

/**
 * Speaks up above the composer when the limit of the provider answering this
 * chat nears its end, and stays until it's put away. Put away (×), it stays
 * away for that limit on every device until the limit resets (`putAway.ts`);
 * the header's meter and its details keep the numbers. At the limit, it says
 * who carries on when you chose someone (ADR 0023).
 */
export function UsageComposerNotice({ engine }: { engine: EngineId | undefined }) {
  const { data: app } = useAppState();
  const { data: providers } = useProviders();
  const ready = Boolean(providers?.providers.find((p) => p.id === engine)?.ready);
  const { data: usage } = useUsage(engine, ready);
  const setUsageOpen = useUi((s) => s.setUsageOpen);
  const save = useUpdateSettings();
  const marks = app?.preferences.limitsPutAway ?? NONE;
  const forEngine = usage && usage.engine === engine ? usage : undefined;

  // A limit that reset (healthy again) gives its line back for the next cycle.
  const next = forEngine && app ? rearm(marks, forEngine) : marks;
  const tidied = next === marks ? undefined : JSON.stringify(next);
  const { mutate } = save;
  const sent = useRef<string>(undefined);
  useEffect(() => {
    if (tidied === undefined || sent.current === tidied) return;
    sent.current = tidied;
    mutate({ preferences: { limitsPutAway: JSON.parse(tidied) as PutAwayLimit[] } });
  }, [tidied, mutate]);

  if (!forEngine || forEngine.kind === 'unknown') return null;
  const limit = limitInView(forEngine);
  if (!limit || isPutAway(marks, limit)) return null;
  const pick = app?.preferences.limitFallback;
  const carryOn = providers?.providers.find(
    (p) => p.id === pick && p.ready && p.id !== engine,
  )?.name;
  return (
    <UsageNotice
      value={forEngine}
      carryOn={carryOn}
      onOpen={() => setUsageOpen(true)}
      onDismiss={() => mutate({ preferences: { limitsPutAway: putAway(marks, limit) } })}
    />
  );
}

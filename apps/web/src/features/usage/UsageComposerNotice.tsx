import type { EngineId, LimitFallback, PutAwayLimit } from '@conch/protocol';
import { UsageNotice } from '@conch/nacre';
import { useEffect, useRef } from 'react';

import { useAppState, useFallbackPlan, useUpdateSettings, useUsage } from '../../api/queries';
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

  const limit = forEngine && forEngine.kind !== 'unknown' ? limitInView(forEngine) : undefined;
  const shown = Boolean(limit && !isPutAway(marks, limit));
  // Who carries on is said only at the limit itself, so it's asked only then.
  const atLimit = Boolean(
    forEngine?.blocked || forEngine?.windows.some((w) => w.usedPercent >= 100),
  );
  const carryOn = useCarryOn(engine, shown && atLimit, app?.preferences.limitFallback);
  if (!forEngine || !limit || !shown) return null;
  return (
    <UsageNotice
      value={forEngine}
      carryOn={carryOn}
      onOpen={() => setUsageOpen(true)}
      onDismiss={() => mutate({ preferences: { limitsPutAway: putAway(marks, limit) } })}
    />
  );
}

/**
 * Who would carry on at this provider's limit (ADR 0126): Automatic's first
 * with room, or your pick while it has room. Asked only while the line shows.
 */
function useCarryOn(
  engine: EngineId | undefined,
  shown: boolean,
  pick: LimitFallback | undefined,
): string | undefined {
  const { data: plan } = useFallbackPlan(engine, shown && Boolean(engine) && pick !== 'wait');
  if (!plan || pick === 'wait') return undefined;
  const room = plan.choices.filter((c) => !c.skip && c.room !== 'none');
  const choice = pick && pick !== 'auto' ? room.find((c) => c.engines.includes(pick)) : room[0];
  return choice?.name;
}

import type { EngineId, LimitFallback, PutAwayLimit } from '@conch/protocol';
import { toast, UsageNotice } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { keys, useAppState, useFallbackPlan, useUpdateSettings, useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useProviders } from '../providers/queries';
import { isPutAway, limitInView, putAway, readBeforeReset, rearm } from './putAway';

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

  const [now, setNow] = useClock();

  // A limit that reset (healthy again) gives its line back for the next cycle.
  const next = forEngine && app ? rearm(marks, forEngine, now) : marks;
  const tidied = next === marks ? undefined : JSON.stringify(next);
  const { mutate } = save;
  const sent = useRef<string>(undefined);
  useEffect(() => {
    if (tidied === undefined || sent.current === tidied) return;
    sent.current = tidied;
    mutate({ preferences: { limitsPutAway: JSON.parse(tidied) as PutAwayLimit[] } });
  }, [tidied, mutate]);

  const limit = forEngine && forEngine.kind !== 'unknown' ? limitInView(forEngine, now) : undefined;
  // A reading from before its reset is spent: the line waits for fresh numbers
  // (asked for right away) rather than saying "resets now" (`putAway.ts`).
  const spent = Boolean(limit && readBeforeReset(limit, now));
  useFreshAtReset(engine, limit?.resetsAt, spent, setNow);
  const shown = Boolean(limit && !spent && !isPutAway(marks, limit, now));
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
      // Away at once (`useUpdateSettings` is optimistic), and back if it didn't save.
      onDismiss={() =>
        mutate(
          { preferences: { limitsPutAway: putAway(marks, limit) } },
          { onError: () => toast.error('That didn’t save. Try again.') },
        )
      }
    />
  );
}

/** The time the line goes by, read again every half minute (and at a reset, `useFreshAtReset`). */
function useClock(): [number, (now: number) => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return [now, setNow];
}

/**
 * Reads the clock again the moment the limit in view resets, and once a
 * reading is from before its reset, asks the provider afresh: the line then
 * shows the new numbers or goes, never a "resets now" left standing.
 */
function useFreshAtReset(
  engine: EngineId | undefined,
  resetsAt: number | undefined,
  spent: boolean,
  setNow: (now: number) => void,
) {
  const client = useQueryClient();
  useEffect(() => {
    if (resetsAt == null || spent) return;
    const wait = resetsAt - Date.now() + 1_000;
    // Far-off resets are met by the usage's own reads before then.
    if (wait > 24 * 60 * 60_000) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, wait));
    return () => clearTimeout(id);
  }, [resetsAt, spent, setNow]);
  const asked = useRef<number>(undefined);
  useEffect(() => {
    if (!spent || !engine || resetsAt == null || asked.current === resetsAt) return;
    asked.current = resetsAt;
    void client.invalidateQueries({ queryKey: keys.usageOf(engine) });
  }, [client, engine, resetsAt, spent]);
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

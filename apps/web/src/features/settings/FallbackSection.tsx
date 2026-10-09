import type { EngineId, FallbackChoice, LimitFallback } from '@conch/protocol';
import {
  FALLBACK_AUTO,
  FALLBACK_WAIT,
  FallbackPicker,
  Skeleton,
  Stack,
  Text,
  type FallbackOption,
} from '@conch/nacre';
import { useEffect, useRef } from 'react';

import { useAppState, useFallbackPlan, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { FALLBACK_FOCUS } from './paths';
import { Section } from './Section';

/** `openSettings('providers', FALLBACK_FOCUS)` brings this section into view. */
export { FALLBACK_FOCUS };

/** A choice as the picker draws it. */
function optionOf(choice: FallbackChoice): FallbackOption {
  return {
    id: choice.id,
    name: choice.name,
    ...(choice.account && { account: choice.account }),
    billing: choice.billing,
    room: choice.room,
    ...(choice.leftPercent !== undefined && { leftPercent: choice.leftPercent }),
    ...(choice.resetsAt !== undefined && { resetsAt: choice.resetsAt }),
    ...(choice.perReplyUsd !== undefined && { perReplyUsd: choice.perReplyUsd }),
    ...(choice.model && { model: choice.model.label }),
    ...(choice.skip && { skip: choice.skip }),
  };
}

/** The gateway's order, with the order you just chose applied before it has said so again. */
export function inYourOrder(
  choices: readonly FallbackChoice[],
  order: readonly EngineId[],
): FallbackChoice[] {
  const at = (c: FallbackChoice) => {
    const found = c.engines.map((id) => order.indexOf(id)).filter((i) => i >= 0);
    return found.length ? Math.min(...found) : Number.POSITIVE_INFINITY;
  };
  return choices
    .map((choice, index) => ({ choice, index }))
    .sort((a, b) => at(a.choice) - at(b.choice) || a.index - b.index)
    .map((entry) => entry.choice);
}

/**
 * Settings → Providers → When one can't answer (ADR 0023, ADR 0126). At a
 * usage limit, Automatic carries on with the next plan or key with room, in
 * an order you can change; or you wait, or name one. Last, the model on this
 * computer — which also answers while you're offline.
 */
export function FallbackSection() {
  const { data: app } = useAppState();
  const { data: plan, isPending } = useFallbackPlan();
  const update = useUpdateSettings();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const { settingsFocus } = useUi.getState();
    if (settingsFocus !== FALLBACK_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const prefs = app?.preferences;
  const choices = inYourOrder(plan?.choices ?? [], prefs?.limitOrder ?? []);
  const pick = prefs?.limitFallback ?? FALLBACK_AUTO;
  // A pick that isn't among the choices now (removed, signed out) shows as Automatic's place
  // would: still saved, but the radio list can only check what it lists.
  const value =
    pick === FALLBACK_AUTO || pick === FALLBACK_WAIT
      ? pick
      : (choices.find((c) => c.engines.includes(pick))?.id ?? FALLBACK_AUTO);
  const from = plan?.fromName ?? 'your provider';
  const save = (preferences: Parameters<typeof update.mutate>[0]['preferences']) =>
    update.mutate({ preferences });

  return (
    <Section
      ref={ref}
      title="When one can’t answer"
      description="So a limit or a dropped connection never leaves a question hanging."
    >
      {/* Not a `Field`: its switches are controls of their own, each with its own name. */}
      <Stack gap={2}>
        <Text id="limit-fallback" size="sm" weight="medium">
          At a usage limit
        </Text>
        {isPending && !plan ? (
          <Skeleton shape="block" height="10rem" />
        ) : (
          <FallbackPicker
            aria-labelledby="limit-fallback"
            from={from}
            {...(plan?.fromResetsAt !== undefined && { fromResetsAt: plan.fromResetsAt })}
            value={value}
            onValueChange={(next) =>
              save({
                // Automatic is the default: choosing it clears the setting.
                limitFallback: next === FALLBACK_AUTO ? null : (next as LimitFallback),
              })
            }
            options={choices.map(optionOf)}
            onReorder={(ids) => save({ limitOrder: ids as EngineId[] })}
            local={{
              ...(plan?.local && { name: plan.local.name }),
              checked: prefs?.offlineFallback ?? true,
              onCheckedChange: (offlineFallback) => save({ offlineFallback }),
            }}
            back={{
              checked: prefs?.limitReturn ?? true,
              onCheckedChange: (limitReturn) => save({ limitReturn }),
            }}
            paid={{
              checked: prefs?.limitPaid ?? false,
              onCheckedChange: (limitPaid) => save({ limitPaid }),
            }}
          />
        )}
      </Stack>
    </Section>
  );
}

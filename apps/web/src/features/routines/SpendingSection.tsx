import type { RoutineSpending } from '@conch/protocol';
import { Field, formatMoney, Input, RoutineSpendingGauge, Stack, Switch, Text } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useUi } from '../../app/ui';
import { Section, SaveStatus } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';
import { routinesApi } from './api';
import { PlanRoomSection } from './PlanRoomSection';
import { routineKeys, useRoutineSpending } from './queries';

/** `openSettings('usage', ROUTINES_SPEND_FOCUS)` brings this section into view. */
export const ROUTINES_SPEND_FOCUS = 'routines';
/** …and `PLAN_ROOM_FOCUS` straight to when routines wait for a plan. */
export const PLAN_ROOM_FOCUS = 'plan-room';
const PLAN_ROOM_ID = 'routines-plan-room';

/** The monthly limit until a person sets one (the gateway's `DEFAULT_MONTHLY_USD`). */
const DEFAULT_LIMIT = 20;

/** Midnight on the 1st of next month, here. */
function nextMonth(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** `undefined` = not a valid amount (yet). */
function parseAmount(text: string): number | undefined {
  const amount = Number(text.replace(/[$,\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/**
 * What routines spend this month, against the limit as it stands on screen:
 * the gauge follows the switch and the amount the moment they change, not
 * when the save comes back.
 */
function SpendingBody({ spending }: { spending: RoutineSpending }) {
  const client = useQueryClient();
  const initial = spending.limitUsd;
  const [on, setOn] = useState(initial !== null);
  const [text, setText] = useState(String(initial ?? DEFAULT_LIMIT));
  // The last valid amount; mid-edit typos never save.
  const [amount, setAmount] = useState(initial ?? DEFAULT_LIMIT);
  const valid = parseAmount(text) !== undefined;
  const limitUsd = on ? amount : null;
  const status = useAutosave(limitUsd, async (next) => {
    client.setQueryData(routineKeys.spending, await routinesApi.setSpendingLimit(next));
    void client.invalidateQueries({ queryKey: routineKeys.all });
  });
  return (
    <Stack gap={5}>
      <RoutineSpendingGauge
        monthUsd={spending.monthUsd}
        limitUsd={limitUsd}
        resetsAt={spending.paused?.until ?? nextMonth()}
        {...(spending.projectedUsd !== undefined && { projectedUsd: spending.projectedUsd })}
      />
      {spending.paused && (
        <Text size="sm" tone="muted">
          Routines that cost money are paused until the 1st. Raise the limit above{' '}
          {formatMoney(spending.monthUsd)} and they go again at their next time.
        </Text>
      )}
      <Stack gap={4}>
        <Switch
          checked={on}
          onCheckedChange={setOn}
          label="Limit what routines spend each month"
          description={
            on
              ? 'At the limit, routines that cost money pause until the 1st, and Conch tells you once.'
              : 'Routines can spend without a monthly limit. Each run still stops if it uses far more than usual.'
          }
        />
        {on && (
          <Field invalid={!valid}>
            <Field.Label>Limit per month (USD)</Field.Label>
            <Input
              inputMode="decimal"
              leading="$"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const next = parseAmount(e.target.value);
                if (next !== undefined) setAmount(next);
              }}
            />
            {valid ? (
              <Field.Description>
                {spending.isDefault
                  ? `Conch starts at ${formatMoney(DEFAULT_LIMIT)}: enough for a daily briefing on a mid-priced model.`
                  : 'Only you can change this. Your assistant can’t.'}
              </Field.Description>
            ) : (
              <Field.Error>Enter an amount above zero, like 20.</Field.Error>
            )}
          </Field>
        )}
        <SaveStatus status={status} />
      </Stack>
      <PlanRoomSection headingLevel={3} id={PLAN_ROOM_ID} />
    </Stack>
  );
}

/**
 * Settings → Usage → Routines: what everything that runs while you're away
 * spent this month, and the limit on it (ADR 0057). A person's choice: the
 * assistant has no way to change it.
 */
export function SpendingSection() {
  const { data: spending } = useRoutineSpending();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const { settingsFocus } = useUi.getState();
    if (settingsFocus !== ROUTINES_SPEND_FOCUS && settingsFocus !== PLAN_ROOM_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    const target =
      settingsFocus === PLAN_ROOM_FOCUS ? document.getElementById(PLAN_ROOM_ID) : ref.current;
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  if (!spending) return null;
  return (
    <Section
      ref={ref}
      title="Routines"
      description="What runs while you’re away may spend with pay-as-you-go providers. Plans and models on this computer don’t count."
    >
      <SpendingBody spending={spending} />
    </Section>
  );
}

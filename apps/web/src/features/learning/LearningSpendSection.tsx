import type { LearningSpending } from '@conch/protocol';
import { Field, formatMoney, Input, RoutineSpendingGauge, Stack, Switch, Text } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useUi } from '../../app/ui';
import { Section, SaveStatus } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';
import { learningApi, learningKeys, useLearning } from './api';

/** `openSettings('usage', LEARNING_SPEND_FOCUS)` brings this section into view. */
export const LEARNING_SPEND_FOCUS = 'learning';

/** The monthly cap until a person sets one (the gateway's `DEFAULT_LEARNING_USD`). */
const DEFAULT_LIMIT = 1;

/** Midnight on the 1st of next month, here. */
function nextMonth(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** `undefined` = not a valid amount (yet). */
function parseAmount(text: string): number | undefined {
  const amount = Number(text.replace(/[$,\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(amount) && amount > 0 && amount <= 1000
    ? amount
    : undefined;
}

function SpendingBody({ spending }: { spending: LearningSpending }) {
  const client = useQueryClient();
  const initial = spending.limitUsd;
  const [on, setOn] = useState(initial !== null);
  const [text, setText] = useState(String(initial ?? DEFAULT_LIMIT));
  // The last valid amount; mid-edit typos never save.
  const [amount, setAmount] = useState(initial ?? DEFAULT_LIMIT);
  const valid = parseAmount(text) !== undefined;
  const limitUsd = on ? amount : null;
  const status = useAutosave(limitUsd, async (next) => {
    await learningApi.setSpending(next);
    void client.invalidateQueries({ queryKey: learningKeys.all });
  });
  return (
    <Stack gap={5}>
      <RoutineSpendingGauge
        label="Learning this month"
        monthUsd={spending.monthUsd}
        limitUsd={limitUsd}
        resetsAt={spending.paused?.until ?? nextMonth()}
      />
      {spending.paused && (
        <Text size="sm" tone="muted">
          Learning that costs money rests until the 1st. Raise the limit above{' '}
          {formatMoney(spending.monthUsd)} and it carries on with your next quiet chat.
        </Text>
      )}
      <Stack gap={4}>
        <Switch
          checked={on}
          onCheckedChange={setOn}
          label="Limit what learning spends each month"
          description={
            on
              ? 'At the limit, learning that costs money rests until the 1st. Your chats aren’t affected.'
              : 'Learning can spend without a monthly limit. It still asks a model only when a chat taught something.'
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
                  ? `Conch starts at ${formatMoney(DEFAULT_LIMIT)}: a few hundred quick looks at your chats with a small model.`
                  : 'Only you can change this. Your assistant can’t.'}
              </Field.Description>
            ) : (
              <Field.Error>Enter an amount above zero, like 1.</Field.Error>
            )}
          </Field>
        )}
        <SaveStatus status={status} />
      </Stack>
    </Stack>
  );
}

/**
 * Settings → Usage → Learning from your chats (ADR 0088): what the quiet
 * looks at your chats spent this month, and the cap on it. A person's choice:
 * the assistant has no way to change it.
 */
export function LearningSpendSection() {
  const { data } = useLearning();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (useUi.getState().settingsFocus !== LEARNING_SPEND_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  if (!data) return null;
  return (
    <Section
      ref={ref}
      title="Learning from your chats"
      description="What a quiet chat costs to learn from, on pay-as-you-go providers."
    >
      <SpendingBody spending={data.spending} />
    </Section>
  );
}

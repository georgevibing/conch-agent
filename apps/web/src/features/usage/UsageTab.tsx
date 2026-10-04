import { Field, Input, Stack, UsagePanel } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys, useUsage } from '../../api/queries';
import { SpendingSection } from '../routines/SpendingSection';
import { Section, SaveStatus } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';
import styles from './Usage.module.css';
import { useUsageRefresh } from './useUsageRefresh';

/** `null` = no budget; `undefined` = not a valid amount (yet). */
function parseBudget(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const amount = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function BudgetField({ initial }: { initial?: number }) {
  const client = useQueryClient();
  const [text, setText] = useState(initial ? String(initial) : '');
  // The last valid amount; mid-edit typos never save.
  const [budget, setBudget] = useState<number | null>(initial ?? null);
  const valid = parseBudget(text) !== undefined;
  const status = useAutosave(budget, async (next) => {
    client.setQueryData(keys.usage, await api.setBudget(next));
  });
  return (
    <Section
      title="Monthly budget"
      description="Optional. It counts what you spend on pay-as-you-go providers through Conch. Near it, a chat says so once; at it, a chat asks before spending more."
      status={<SaveStatus status={status} />}
    >
      <Field invalid={!valid}>
        <Field.Label>Budget per month (USD)</Field.Label>
        <Input
          inputMode="decimal"
          leading="$"
          placeholder="No budget"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const next = parseBudget(e.target.value);
            if (next !== undefined) setBudget(next);
          }}
        />
        {valid ? (
          <Field.Description>Leave empty for no budget.</Field.Description>
        ) : (
          <Field.Error>Enter an amount above zero, like 50.</Field.Error>
        )}
      </Field>
    </Section>
  );
}

/** Settings → Usage: the full picture, plus a budget for pay-as-you-go sign-ins. */
export function UsageTab() {
  const { data: usage } = useUsage();
  const { refresh, refreshing } = useUsageRefresh();
  if (!usage) return null;
  return (
    <Stack gap={6}>
      <Section
        title="What’s left"
        description={usage.kind === 'unknown' ? 'Connect a provider to see your usage.' : undefined}
      >
        {usage.kind !== 'unknown' && (
          <UsagePanel
            value={usage}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            className={styles.inline}
          />
        )}
      </Section>
      {/* Every chat on a key you pay as you go counts, whichever provider is the default (ADR 0073). */}
      <BudgetField initial={usage.spend.budget} />
      <SpendingSection />
    </Stack>
  );
}

import type { EngineId, UsageSnapshot } from '@conch/protocol';
import { Field, Input, ProviderLogo, Stack, Text, UsagePanel } from '@conch/nacre';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys, useUsage } from '../../api/queries';
import { providerLogo } from '../models/catalog';
import { useProviders } from '../providers/queries';
import { SpendingSection } from '../routines/SpendingSection';
import { Section, SaveStatus } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';
import { TurnLimitsSection } from './TurnLimitsSection';
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
    const snapshot = await api.setBudget(next);
    // Spend is Conch-wide: every provider's numbers say the new budget.
    if (snapshot.engine) client.setQueryData(keys.usageOf(snapshot.engine), snapshot);
    void client.invalidateQueries({ queryKey: keys.usage });
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

/** One provider's limits, under its name. */
function ProviderUsage({ engine, name }: { engine: EngineId; name: string }) {
  const { data: usage } = useUsage(engine);
  const { refresh, refreshing } = useUsageRefresh(engine);
  if (!usage) return null;
  return (
    <Stack gap={2}>
      <Stack direction="row" gap={2} align="center">
        <ProviderLogo provider={providerLogo(engine)} size={14} />
        <Text size="sm" weight="medium">
          {name}
        </Text>
      </Stack>
      <UsagePanel
        value={usage}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        className={styles.inline}
      />
    </Stack>
  );
}

/** What a provider's limits say, apart from when they were read. */
const limitsOf = (u: UsageSnapshot) =>
  JSON.stringify([u.source, u.kind, u.windows, u.extra, u.blocked]);

/**
 * Settings → Usage: what's left with every provider you've connected (each
 * chat's header shows its own), plus a budget for pay-as-you-go sign-ins.
 */
export function UsageTab() {
  const { data: list } = useProviders();
  const ready = (list?.providers ?? []).filter((p) => p.ready);
  const usages = useQueries({
    queries: ready.map((p) => ({
      queryKey: keys.usageOf(p.id),
      queryFn: () => api.usage(false, p.id),
      staleTime: 60_000,
    })),
  });
  if (!list) return null;
  // Spend is Conch-wide: any provider's numbers carry it.
  const spend = usages.find((u) => u.data)?.data?.spend;
  // Codex and Codex CLI are one ChatGPT plan: when their limits read the same, show Codex once.
  const codex = ready.findIndex((p) => p.id === 'codex-cli');
  const codexLimits = codex >= 0 && usages[codex]?.data ? limitsOf(usages[codex].data) : undefined;
  const shown = ready.filter((p, i) => {
    const data = usages[i]?.data;
    return !(p.id === 'codex-agent' && data && codexLimits === limitsOf(data));
  });
  return (
    <Stack gap={6}>
      <Section
        title="What’s left"
        description={ready.length ? undefined : 'Connect a provider to see your usage.'}
      >
        <Stack gap={5}>
          {shown.map((p) => (
            <ProviderUsage key={p.id} engine={p.id} name={p.name} />
          ))}
        </Stack>
      </Section>
      {/* Every chat on a key you pay as you go counts, whichever provider answers it (ADR 0079). */}
      {spend && <BudgetField initial={spend.budget} />}
      <SpendingSection />
      <TurnLimitsSection />
    </Stack>
  );
}

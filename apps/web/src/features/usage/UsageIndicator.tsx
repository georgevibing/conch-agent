import { Popover, UsageMeter, UsagePanel } from '@conch/nacre';

import { useAppState, useUsage } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useUsageRefresh } from './useUsageRefresh';

/** Fresh enough to show without re-reading the provider when the panel opens. */
const FRESH_MS = 30_000;

/**
 * The fuel gauge in the header: what's left of your tightest limit, one click
 * from the full picture. `/usage`, the palette and the composer notice open it too.
 */
export function UsageIndicator() {
  const { data: app } = useAppState();
  const ready = app?.engine.state === 'ready';
  const { data: usage } = useUsage(ready);
  const open = useUi((s) => s.usageOpen);
  const setOpen = useUi((s) => s.setUsageOpen);
  const openSettings = useUi((s) => s.openSettings);
  const { refresh, refreshing } = useUsageRefresh();

  if (!ready || !usage || usage.kind === 'unknown') return null;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && Date.now() - usage.updatedAt > FRESH_MS) void refresh();
      }}
    >
      <Popover.Trigger asChild>
        <UsageMeter value={usage} />
      </Popover.Trigger>
      <Popover.Content
        align="end"
        aria-label="Usage"
        // The panel brings its own padding and width.
        padding="none"
        // Focus the panel itself, not the refresh button (whose tooltip would pop up).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <UsagePanel
          value={usage}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          onSetBudget={
            usage.kind === 'metered'
              ? () => {
                  setOpen(false);
                  openSettings('usage');
                }
              : undefined
          }
        />
      </Popover.Content>
    </Popover.Root>
  );
}

import { SettingsRow, SettingsSubpages, Stack } from '@conch/nacre';
import { Power } from 'lucide-react';

import { AlwaysOnSection, useBackground } from '../background/AlwaysOnSection';
import { HealedSection } from '../settings/HealedSection';
import { useSubpage } from '../settings/subpages';
import { BackupSection } from './BackupSection';
import { RepairSection } from './RepairSection';
import { UpdatesHeadline, UpdatesSection } from './UpdatesSection';

/**
 * Settings → Health: how every part of Conch is doing and one button that
 * repairs it, updates and backups, what it already fixed on its own, and a
 * row to how it keeps running — Always on, a page of its own
 * (`/settings/health/always-on`): the menu bar, after logging out, keeping
 * awake, and quitting.
 */
export function HealthTab() {
  const { page, open } = useSubpage('health');
  return (
    <SettingsSubpages page={page}>
      {page === 'always-on' ? (
        <AlwaysOnSection />
      ) : (
        <Stack gap={8}>
          <UpdatesHeadline />
          <RepairSection />
          <UpdatesSection />
          <BackupSection />
          <AlwaysOnRow onOpen={() => open('always-on')} />
          <HealedSection />
        </Stack>
      )}
    </SettingsSubpages>
  );
}

/** Always on, in a row: whether Conch starts by itself, and the way to the rest. */
function AlwaysOnRow({ onOpen }: { onOpen: () => void }) {
  const { data: status } = useBackground();
  const value = !status
    ? undefined
    : status.problem
      ? 'Needs a look'
      : !status.supported
        ? 'Not here'
        : status.on
          ? 'On'
          : 'Off';
  return (
    <SettingsRow
      page="always-on"
      icon={<Power />}
      label="Always on"
      description="Starting when you log in, the menu bar, keeping awake, quitting"
      value={value}
      onClick={onOpen}
    />
  );
}

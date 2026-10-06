import { Stack } from '@conch/nacre';

import { AlwaysOnSection } from '../background/AlwaysOnSection';
import { HealedSection } from '../settings/HealedSection';
import { BackupSection } from './BackupSection';
import { RepairSection } from './RepairSection';
import { UpdatesHeadline, UpdatesSection } from './UpdatesSection';

/**
 * Settings → Health: how every part of Conch is doing and one button that
 * repairs it, updates and backups, keeping it running, and what it already
 * fixed on its own.
 */
export function HealthTab() {
  return (
    <Stack gap={8}>
      <UpdatesHeadline />
      <RepairSection />
      <UpdatesSection />
      <BackupSection />
      <AlwaysOnSection />
      <HealedSection />
    </Stack>
  );
}

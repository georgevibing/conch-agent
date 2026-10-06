import { SettingsAdvanced, Stack } from '@conch/nacre';

import { AlwaysOnSection, BACKGROUND_FOCUS } from '../background/AlwaysOnSection';
import { HealedSection } from '../settings/HealedSection';
import { useAdvanced } from '../settings/useAdvanced';
import { BackupSection } from './BackupSection';
import { RepairSection } from './RepairSection';
import { UpdatesHeadline, UpdatesSection } from './UpdatesSection';

/**
 * Settings → Health: how every part of Conch is doing and one button that
 * repairs it, updates and backups — with keeping it running, and what it
 * already fixed on its own, under Advanced.
 */
export function HealthTab() {
  const [advanced, setAdvanced] = useAdvanced(BACKGROUND_FOCUS);
  return (
    <Stack gap={8}>
      <UpdatesHeadline />
      <RepairSection />
      <UpdatesSection />
      <BackupSection />
      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <AlwaysOnSection />
        <HealedSection />
      </SettingsAdvanced>
    </Stack>
  );
}

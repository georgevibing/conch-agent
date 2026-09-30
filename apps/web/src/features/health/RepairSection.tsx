import type { DoctorAction, DoctorItem } from '@conch/protocol';
import { Button, CopyButton, RepairPanel } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';

import { useUi, type SettingsTab } from '../../app/ui';
import { useNeed } from '../setup/useNeed';
import { doctorApi, healthKeys } from './api';
import { useDoctor } from './queries';

function NeedButton({ action }: { action: Extract<DoctorAction, { kind: 'need' }> }) {
  const { act, running } = useNeed(action.need);
  return (
    <Button size="sm" variant="surface" loading={running} onClick={() => void act(action.mode)}>
      {action.label}
    </Button>
  );
}

/** The one button for an item that needs a person. */
function ActionButton({ action }: { action: DoctorAction }) {
  const openSettings = useUi((s) => s.openSettings);
  if (action.kind === 'need') return <NeedButton action={action} />;
  if (action.kind === 'command') return <CopyButton value={action.command} label={action.label} />;
  return (
    <Button
      size="sm"
      variant="surface"
      onClick={() => {
        // A page, not a part of Settings: close Settings and go there, in the app.
        const page =
          action.place === 'integrations'
            ? '/integrations'
            : action.place === 'channels'
              ? `/channels${action.focus ? `/${encodeURIComponent(action.focus)}` : ''}`
              : undefined;
        if (!page) return openSettings(action.place as SettingsTab, action.focus);
        useUi.getState().closeSettings();
        window.dispatchEvent(new CustomEvent('conch:navigate', { detail: page }));
      }}
    >
      {action.label}
    </Button>
  );
}

/** Repair everything (idea 2): every part of Conch, and one button. */
export function RepairSection() {
  const client = useQueryClient();
  const { data } = useDoctor();
  const run = (repair: boolean) =>
    void (repair ? doctorApi.repair() : doctorApi.check()).then((report) =>
      client.setQueryData(healthKeys.doctor, report),
    );
  const items = (data?.items ?? []).map((item: DoctorItem) => ({
    ...item,
    action:
      item.action && item.state === 'needs-you' ? <ActionButton action={item.action} /> : undefined,
  }));
  return (
    <RepairPanel
      items={items}
      running={data?.running ?? true}
      repairing={data?.repaired ?? false}
      checkedAt={data?.checkedAt ?? 0}
      onRepair={() => run(true)}
      onCheck={() => run(false)}
    />
  );
}

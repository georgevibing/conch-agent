import type { DoctorAction, DoctorItem } from '@conch/protocol';
import { Button, RepairPanel } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useUi, type SettingsTab } from '../../app/ui';
import { AdminCommand } from '../setup/AdminCommand';
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
  const setPulseOpen = useUi((s) => s.setPulseOpen);
  if (action.kind === 'need') return <NeedButton action={action} />;
  if (action.kind === 'command')
    return (
      <AdminCommand compact command={action.command} label={action.label} watch={action.watch} />
    );
  return (
    <Button
      size="sm"
      variant="surface"
      onClick={() => {
        // A page, not a part of Settings: close Settings and go there, in the app.
        const page =
          action.place === 'integrations'
            ? '/apps'
            : action.place === 'channels'
              ? action.focus
                ? `/channels/${encodeURIComponent(action.focus)}`
                : '/apps?show=talk'
              : action.place === 'passwords'
                ? action.focus === '1password'
                  ? '/passwords?manage=1password'
                  : '/passwords'
                : action.place === 'memory'
                  ? '/memory'
                  : action.place === 'tasks'
                    ? // One task: its chat. Several: the likeliest one's, with the pearl's list open.
                      action.focus
                      ? `/c/${encodeURIComponent(action.focus)}`
                      : '/tasks'
                    : action.place === 'skills'
                      ? `/skills${action.focus ? `/${encodeURIComponent(action.focus)}` : ''}`
                      : action.place === 'routines'
                        ? `/routines${action.focus ? `/${encodeURIComponent(action.focus)}` : ''}`
                        : undefined;
        if (!page) return openSettings(action.place as SettingsTab, action.focus);
        window.dispatchEvent(new CustomEvent('conch:navigate', { detail: page }));
        if (action.place === 'tasks' && !action.focus) setPulseOpen(true);
      }}
    >
      {action.label}
    </Button>
  );
}

/** The groups a person opened or folded, kept while this tab is open. */
const OPENED_KEY = 'conch:repair-groups';

function readOpened(): Record<string, boolean> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(OPENED_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(
      Object.entries(raw).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
    );
  } catch {
    return {};
  }
}

/** Repair everything (idea 2): every part of Conch, and one button. */
export function RepairSection() {
  const client = useQueryClient();
  const { data } = useDoctor();
  const [opened, setOpened] = useState(readOpened);
  const remember = (next: Record<string, boolean>) => {
    setOpened(next);
    try {
      sessionStorage.setItem(OPENED_KEY, JSON.stringify(next));
    } catch {
      // Remembering is a nicety.
    }
  };
  const run = (repair: boolean) =>
    void (repair ? doctorApi.repair() : doctorApi.check()).then((report) =>
      client.setQueryData(healthKeys.doctor, report),
    );
  const items = (data?.items ?? []).map((item: DoctorItem) => ({
    ...item,
    // Whatever carries an action shows its one button, beside it; what a repair
    // fixes offers the repair itself.
    action: item.action ? (
      <ActionButton action={item.action} />
    ) : item.repairable && !data?.running ? (
      <Button size="sm" variant="surface" onClick={() => run(true)}>
        Repair
      </Button>
    ) : undefined,
  }));
  return (
    <RepairPanel
      items={items}
      running={data?.running ?? true}
      repairing={data?.repaired ?? false}
      checkedAt={data?.checkedAt ?? 0}
      onRepair={() => run(true)}
      onCheck={() => run(false)}
      opened={opened}
      onOpenedChange={remember}
    />
  );
}

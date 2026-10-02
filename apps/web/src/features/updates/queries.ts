import type { ReleaseChannel, UpdatesStatus } from '@conch/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
import { restartConch } from '../health/restart';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { updateKeys, updatesApi } from './api';

/** Something is moving: a check, Conch's own update, or a program's. */
export function updatesBusy(status: UpdatesStatus | undefined): boolean {
  return Boolean(
    status &&
    (status.checking ||
      status.conch.running ||
      status.programs.some((program) => program.state !== 'idle')),
  );
}

/** How many updates wait: Conch's own counts as one, each program as one. */
export function updatesWaiting(status: UpdatesStatus | undefined): number {
  if (!status) return 0;
  return (
    (status.conch.behind > 0 ? 1 : 0) +
    status.programs.filter((program) => program.available).length
  );
}

/**
 * The page rests on "Updating Conch…" while the gateway starts itself again
 * on the new version, and reloads by itself when it's back (`RestartWatch`).
 */
export function followRestart(status: UpdatesStatus): void {
  if (status.conch.running?.phase !== 'restart') return;
  const ui = useUi.getState();
  if (ui.restarting) return;
  // The calm screen, not a dialog on top of it; Health opens again afterwards.
  const reopen = ui.settings ?? undefined;
  ui.closeSettings();
  ui.setPalette(false);
  ui.setRestarting({ title: 'Updating Conch…', from: status.bootId, reopen });
}

/**
 * What's waiting, kept live by the `updates.changed` event — and looked at
 * every second while something moves, in case an event goes missing.
 */
export function useUpdates() {
  return useQuery({
    queryKey: updateKeys.status,
    queryFn: updatesApi.status,
    staleTime: 60_000,
    refetchInterval: (query) => (updatesBusy(query.state.data) ? 1000 : false),
  });
}

/**
 * Checking, updating and the automatic switch. Updating (and turning
 * automatic updates on) asks you to confirm it's you, like any install.
 */
export function useUpdateActions() {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();

  const run = async (name: string, task: () => Promise<UpdatesStatus>): Promise<boolean> => {
    setError(undefined);
    setPending(name);
    try {
      return await guard(async () => {
        const status = await task();
        client.setQueryData(updateKeys.status, status);
      });
    } catch (e) {
      setError(errorText(e, 'Couldn’t start it.'));
      return false;
    } finally {
      setPending(undefined);
    }
  };

  /**
   * Start Conch again, confirming it's you first if it's been a while.
   * Returns a sentence to show instead when it didn't (a chat is working,
   * or Conch can't restart itself here).
   */
  const restart = async (title: string): Promise<string | undefined> => {
    let note: string | undefined;
    try {
      await guard(async () => {
        note = await restartConch(title);
      });
    } catch (e) {
      note =
        e instanceof ApiError && e.code === 'busy'
          ? e.message
          : 'Conch couldn’t restart just now. Try again in a moment.';
    }
    return note;
  };

  return {
    restart,
    check: () => run('check', updatesApi.check),
    updateConch: () => run('conch', updatesApi.updateConch),
    updateAll: () => run('all', updatesApi.updateAll),
    updateProgram: (id: string) => run(`program:${id}`, () => updatesApi.updateProgram(id)),
    setAuto: (auto: boolean) => run('auto', () => updatesApi.setAuto(auto)),
    /** Beta and alpha ask you to confirm it's you; back to stable doesn't. */
    setChannel: (channel: ReleaseChannel) =>
      run('channel', () => updatesApi.setSettings({ channel })),
    setEveryChange: (everyChange: boolean) =>
      run('every-change', () => updatesApi.setSettings({ everyChange })),
    /** "Conch 0.3 is ready" put away: not shown again for that version. */
    dismiss: (version: string) =>
      run('dismiss', () => updatesApi.setSettings({ dismiss: version })),
    dismissNotice: (id: string) =>
      run('notice', () => updatesApi.setSettings({ dismissNotice: id })),
    goBack: () => run('back', updatesApi.goBack),
    pending,
    error,
    dialog,
  };
}

import type { UpdatesStatus } from '@conch/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
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

  return {
    check: () => run('check', updatesApi.check),
    updateConch: () => run('conch', updatesApi.updateConch),
    updateAll: () => run('all', updatesApi.updateAll),
    updateProgram: (id: string) => run(`program:${id}`, () => updatesApi.updateProgram(id)),
    setAuto: (auto: boolean) => run('auto', () => updatesApi.setAuto(auto)),
    pending,
    error,
    dialog,
  };
}

import type { ReleaseChannel, RestartBody, UpdateConchBody, UpdatesStatus } from '@conch/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
import { restartConch } from '../health/restart';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { updateKeys, updatesApi } from './api';

/** What a restart that met working chats says: the dialog asks first instead. */
export const BUSY = 'busy';

/** Something is moving: a check, Conch's own update, or a program's. */
export function updatesBusy(status: UpdatesStatus | undefined): boolean {
  return Boolean(
    status &&
    (status.checking ||
      status.conch.running ||
      status.programs.some((program) => program.state !== 'idle')),
  );
}

/** How many updates wait: Conch's own counts as one, each program and each app as one. */
export function updatesWaiting(status: UpdatesStatus | undefined): number {
  if (!status) return 0;
  return (
    (status.conch.behind > 0 ? 1 : 0) +
    status.programs.filter((program) => program.available).length +
    // Apps you added with a newer version (ADR 0061): each counts as one.
    (status.apps?.length ?? 0)
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
  // The calm screen, not a dialog on top of it: Settings steps aside, and the
  // address keeps it where it was (Health) for after the reload.
  ui.setRestarting({ title: 'Starting the new Conch', from: status.bootId, update: true });
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
  const restart = async (
    title: string,
    when: RestartBody['when'] = 'now',
  ): Promise<string | undefined> => {
    let note: string | undefined;
    try {
      await guard(async () => {
        note = await restartConch(title, when);
      });
    } catch (e) {
      // Something is working: the dialog asks first (`BUSY`), and never just sits there.
      note =
        e instanceof ApiError && e.code === 'busy'
          ? BUSY
          : 'Conch couldn’t restart just now. Try again in a moment.';
    }
    return note;
  };

  /**
   * Update Conch. `now` while something works answers `busy` (the dialog then
   * asks first, naming it, from the status this brings back); `anyway` pauses
   * that work and carries it on after; `idle` waits for it; `cancel` stops waiting.
   */
  const updateConch = async (
    when: UpdateConchBody['when'] = 'now',
  ): Promise<'started' | 'busy' | 'failed'> => {
    let busy = false;
    const ok = await run('conch', async () => {
      try {
        return await updatesApi.updateConch(when);
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'busy') throw e;
        busy = true;
        return updatesApi.status();
      }
    });
    return busy ? 'busy' : ok ? 'started' : 'failed';
  };

  return {
    restart,
    check: () => run('check', updatesApi.check),
    updateConch,
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

/** A page asks for a fresh look at most this often; the gateway holds back further. */
const LOOK_EVERY_MS = 60_000;

/**
 * Coming back to Conch (opening it, switching to its tab, unlocking the
 * phone, the network returning) asks for a quick look for a new Conch, so the
 * Update button shows up without waiting for the next scheduled look. What it
 * finds reaches the page at once; the gateway's own look runs every quarter
 * hour as well.
 */
export function useLookWhenBack(): void {
  const client = useQueryClient();
  useEffect(() => {
    let last = 0;
    const look = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < LOOK_EVERY_MS) return;
      last = Date.now();
      void updatesApi
        .look()
        .then((next) => client.setQueryData(updateKeys.status, next))
        .catch(() => undefined);
    };
    look();
    document.addEventListener('visibilitychange', look);
    window.addEventListener('focus', look);
    window.addEventListener('online', look);
    return () => {
      document.removeEventListener('visibilitychange', look);
      window.removeEventListener('focus', look);
      window.removeEventListener('online', look);
    };
  }, [client]);
}

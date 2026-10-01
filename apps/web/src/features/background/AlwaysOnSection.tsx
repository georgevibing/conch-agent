import type { BackgroundStatus } from '@conch/protocol';
import { AlertDialog, AlwaysOn, Button, toast } from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Power } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi, type SettingsTab } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { Section } from '../settings/Section';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { bootId } from '../health/restart';
import { backgroundApi, backgroundKeys } from './api';
import { RunningOptions } from './RunningOptions';

/** ⌘K and Repair everything open it by name (`openSettings('health', 'background')`). */
export const BACKGROUND_FOCUS = 'background';

/** "9:14 AM" today, "yesterday" or "3 days ago" before. */
export function sinceText(at: number, now = Date.now()): string {
  const started = new Date(at);
  if (started.toDateString() === new Date(now).toDateString())
    return started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return relativeTime(at, now);
}

export function useBackground() {
  return useQuery({
    queryKey: backgroundKeys.status,
    queryFn: backgroundApi.status,
    staleTime: 30_000,
  });
}

/**
 * Turning Always on on or off, and quitting, each asking that it's you if
 * it's been a while. Turning it on from a Terminal window moves Conch to the
 * background: the page rests on the calm restart screen and comes back by
 * itself, where it was (`reopen`: a settings tab to show again).
 */
export function useAlwaysOnActions(reopen?: SettingsTab) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [busy, setBusy] = useState(false);

  const change = async (on: boolean) => {
    setBusy(true);
    const from = await bootId();
    try {
      await guard(async () => {
        const result = await backgroundApi.set(on);
        client.setQueryData<BackgroundStatus>(backgroundKeys.status, result.status);
        if (result.handover)
          useUi
            .getState()
            .setRestarting({ title: 'Moving Conch to the background…', from, reopen });
        else if (on && result.status.on && !result.status.problem)
          toast.success('Conch will start by itself when you log in.');
      });
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'That didn’t change. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const quit = async () => {
    const from = await bootId();
    try {
      await guard(async () => {
        await backgroundApi.quit();
        useUi.getState().setRestarting({ title: 'Conch has stopped', from, stopped: true });
      });
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'Conch didn’t quit. Try again.');
    }
  };

  return { change, quit, busy, dialog };
}

/**
 * Settings → Health → Always on: Conch starting when you log in and running
 * with no window. Quitting asks first, and the page waits for Conch to be
 * opened again.
 */
export function AlwaysOnSection() {
  const { data: status } = useBackground();
  const { change, quit, busy, dialog } = useAlwaysOnActions('health');
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [adding, setAdding] = useState(false);
  const client = useQueryClient();
  const root = useRef<HTMLElement>(null);
  const focus = useUi((s) => s.settingsFocus);

  useEffect(() => {
    if (focus !== BACKGROUND_FOCUS || !status) return;
    useUi.setState({ settingsFocus: undefined });
    root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    root.current
      ?.querySelector<HTMLButtonElement>('[role="switch"]')
      ?.focus({ preventScroll: true });
  }, [focus, status]);

  if (!status) return null;

  const canQuit = status.running !== 'dev';
  const addShortcut = async () => {
    setAdding(true);
    try {
      const next = await backgroundApi.addShortcut();
      client.setQueryData<BackgroundStatus>(backgroundKeys.status, next);
      toast.success(
        `Conch is in ${next.shortcut?.where ?? 'your apps'}. Open it from there any time.`,
      );
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'That didn’t work. Try again.');
    } finally {
      setAdding(false);
    }
  };
  return (
    <Section
      ref={root}
      title="Always on"
      description="Keep Conch running by itself, so routines run on time and your phone and chat apps can always reach it."
    >
      <AlwaysOn
        on={status.on}
        onOnChange={status.supported ? (on) => void change(on) : undefined}
        running={status.running}
        since={sinceText(status.since)}
        busy={busy}
        needed={status.needed}
        problem={status.problem}
        unsupported={status.supported ? undefined : status.unsupported}
        place={status.place}
        options={
          status.tray || status.afterLogout || status.keepAwake ? (
            <RunningOptions status={status} />
          ) : undefined
        }
      >
        {status.shortcut && !status.shortcut.installed && (
          <Button
            size="sm"
            variant="surface"
            leadingIcon={<AppWindow />}
            loading={adding}
            onClick={() => void addShortcut()}
          >
            Add Conch to {status.shortcut.where}
          </Button>
        )}
        {canQuit && (
          <Button
            size="sm"
            variant="surface"
            leadingIcon={<Power />}
            onClick={() => setConfirmQuit(true)}
          >
            Quit Conch
          </Button>
        )}
      </AlwaysOn>
      <AlertDialog.Root open={confirmQuit} onOpenChange={setConfirmQuit}>
        <AlertDialog.Content icon={<Power />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Quit Conch?</AlertDialog.Title>
            <AlertDialog.Description>
              Your other devices, chat apps and routines can’t reach Conch until it’s open again.
              {status.on
                ? ' It starts again by itself when you log in.'
                : ' Open it again from your apps, or run pnpm start.'}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep running</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                setConfirmQuit(false);
                void quit();
              }}
            >
              Quit Conch
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </Section>
  );
}

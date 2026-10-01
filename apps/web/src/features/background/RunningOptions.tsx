import type { BackgroundStatus } from '@conch/protocol';
import { CopyButton, Stack, Switch, Text, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { GetIt } from '../setup/GetIt';
import { backgroundApi, backgroundKeys } from './api';

const WHERE_LABEL: Record<string, string> = {
  'menu bar': 'Show Conch in the menu bar',
  tray: 'Show Conch in the tray',
  panel: 'Show Conch in the panel',
};

/**
 * How Conch runs, under Always on (ADR 0029): the menu bar, after logging
 * out (a little computer), and keeping a Mac awake. Each row only where it
 * means something on this computer.
 */
export function RunningOptions({ status }: { status: BackgroundStatus }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [busy, setBusy] = useState<string>();
  const put = (next: BackgroundStatus) => client.setQueryData(backgroundKeys.status, next);

  const act = async (name: string, task: () => Promise<BackgroundStatus>) => {
    setBusy(name);
    try {
      await guard(async () => put(await task()));
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'That didn’t change. Try again.');
    } finally {
      setBusy(undefined);
    }
  };

  const { tray, afterLogout, keepAwake } = status;
  if (!tray && !afterLogout && !keepAwake) return null;
  return (
    <Stack gap={4}>
      {tray && (
        <Stack gap={2}>
          <Switch
            labelPosition="start"
            checked={tray.on && tray.available}
            disabled={!tray.available || busy === 'tray'}
            onCheckedChange={(on) => void act('tray', () => backgroundApi.tray(on))}
            label={WHERE_LABEL[tray.where] ?? 'Show Conch in the menu bar'}
            description={
              tray.available
                ? 'Whether it’s running, a dot when something needs you, and Open, Start or Quit in one click.'
                : tray.unavailable
            }
          />
          {!tray.available && tray.need && <GetIt needId={tray.need} />}
        </Stack>
      )}
      {afterLogout && (
        <Stack gap={2}>
          {afterLogout.state === 'unavailable' ? (
            <Text size="sm" tone="muted">
              {afterLogout.note}
            </Text>
          ) : (
            <Switch
              labelPosition="start"
              checked={afterLogout.state === 'on'}
              disabled={busy === 'logout'}
              onCheckedChange={(on) => void act('logout', () => backgroundApi.afterLogout(on))}
              label="Keep running after you log out"
              description="For a computer that stays on: routines run and your phone reaches Conch with nobody logged in."
            />
          )}
          {afterLogout.command && (
            <Stack gap={1}>
              {afterLogout.note && (
                <Text size="sm" tone="muted">
                  {afterLogout.note}
                </Text>
              )}
              <span>
                <code>{afterLogout.command}</code>{' '}
                <CopyButton value={afterLogout.command} label="Copy command" />
              </span>
            </Stack>
          )}
        </Stack>
      )}
      {keepAwake && (
        <Switch
          labelPosition="start"
          checked={keepAwake.on}
          disabled={busy === 'awake'}
          onCheckedChange={(on) => void act('awake', () => backgroundApi.keepAwake(on))}
          label="Keep this Mac awake"
          description={
            keepAwake.on && !keepAwake.active
              ? 'It starts when Conch runs in the background.'
              : 'On mains power, it won’t sleep while Conch runs, so routines and your phone always reach it.'
          }
        />
      )}
      {dialog}
    </Stack>
  );
}

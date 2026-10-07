import type { PushPrefs, PushStatus } from '@conch/protocol';
import {
  AddToHomeScreen,
  Button,
  NotifyThisDevice,
  Stack,
  Switch,
  Text,
  toast,
  type NotifyState,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { Section } from '../settings/Section';
import styles from './Notifications.module.css';
import { pushApi, pushKeys } from './api';
import {
  current,
  matches,
  permission,
  pushSupport,
  PushServiceError,
  subscribe,
  unsubscribe,
} from './browser';

export function usePush() {
  return useQuery({ queryKey: pushKeys.status, queryFn: pushApi.status, staleTime: 15_000 });
}

const TOPICS: { key: keyof PushPrefs; label: string; description?: string }[] = [
  { key: 'approvals', label: 'When it needs you' },
  { key: 'replies', label: 'When an answer is ready' },
  { key: 'routines', label: 'When a routine runs' },
  { key: 'tasks', label: 'When a task finishes' },
  { key: 'devices', label: 'When a new device wants to sign in' },
  { key: 'updates', label: 'New versions of Conch' },
  {
    key: 'previews',
    label: 'Say what it’s about',
    description: 'Off: only “Open Conch to see what it’s asking.”',
  },
];

/** This device's state, from the browser and from Conch. */
function stateOf(status: PushStatus | undefined, subscribed: boolean): NotifyState {
  const support = pushSupport();
  if (support === 'install') return 'install';
  if (support !== 'ok') return 'unsupported';
  if (permission() === 'denied') return 'blocked';
  return subscribed && status?.devices.some((d) => d.current) ? 'on' : 'off';
}

/**
 * Settings → Notifications (ADR 0027): this device, one switch and what it's
 * told about. Which other devices get them, and stopping one, is in
 * Settings → Devices, beside each device.
 */
export function NotificationsTab() {
  const client = useQueryClient();
  const { data: status } = usePush();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  // What to change in the browser first; it stays on the card while they do it.
  const [problem, setProblem] = useState<string>();
  const openSettings = useUi((s) => s.openSettings);

  useEffect(() => {
    if (!status) return;
    void current().then((sub) => setSubscribed(matches(sub, status.publicKey)));
  }, [status]);

  const put = (next: PushStatus) => client.setQueryData(pushKeys.status, next);
  const mine = status?.devices.find((d) => d.current);
  const state = stateOf(status, subscribed);

  const change = async (on: boolean) => {
    if (!status) return;
    setBusy(true);
    setProblem(undefined);
    try {
      if (on) {
        put(await pushApi.subscribe(await subscribe(status.publicKey)));
        setSubscribed(true);
        toast.success('Notifications are on for this device.');
      } else {
        if (mine) put(await pushApi.remove(mine.id));
        await unsubscribe().catch(() => undefined);
        setSubscribed(false);
      }
    } catch (failure) {
      if (failure instanceof PushServiceError) setProblem(failure.message);
      toast.error(
        failure instanceof ApiError || failure instanceof Error
          ? failure.message
          : 'That didn’t work. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const prefer = async (key: keyof PushPrefs, value: boolean) => {
    if (!mine || !status) return;
    put({
      ...status,
      devices: status.devices.map((d) =>
        d.id === mine.id ? { ...d, prefs: { ...d.prefs, [key]: value } } : d,
      ),
    });
    try {
      put(await pushApi.update(mine.id, { [key]: value }));
    } catch {
      toast.error('That didn’t save. Try again.');
      void client.invalidateQueries({ queryKey: pushKeys.status });
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { sent } = await pushApi.test();
      if (!sent)
        toast.error('It didn’t arrive. Turn notifications off and on again on this device.');
    } finally {
      setTesting(false);
    }
  };

  const others = (status?.devices ?? []).filter((d) => !d.current);
  return (
    <Stack gap={8}>
      <Section
        title="This device"
        description="Told when something needs you, quiet while you’re looking."
      >
        <NotifyThisDevice
          state={state}
          busy={busy}
          onChange={(on) => void change(on)}
          onTest={() => void test()}
          testing={testing}
          detail={
            pushSupport() === 'insecure'
              ? 'Notifications need Conch’s secure (https) address. Add your phone to turn it on.'
              : state === 'off'
                ? problem
                : undefined
          }
        >
          {state === 'install' ? (
            <AddToHomeScreen />
          ) : state === 'on' && mine ? (
            <Stack gap={3}>
              {TOPICS.map((topic) => (
                <Switch
                  key={topic.key}
                  labelPosition="start"
                  label={topic.label}
                  description={topic.description}
                  checked={mine.prefs[topic.key]}
                  onCheckedChange={(value) => void prefer(topic.key, value)}
                />
              ))}
            </Stack>
          ) : undefined}
        </NotifyThisDevice>
      </Section>

      <div className={styles.elsewhere}>
        <Text size="sm" tone="muted">
          {others.length === 0
            ? 'No other device gets them yet.'
            : others.length === 1
              ? '1 other device gets them too.'
              : `${others.length} other devices get them too.`}
        </Text>
        <Button
          size="sm"
          variant="surface"
          leadingIcon={<MonitorSmartphone />}
          onClick={() => openSettings('devices')}
        >
          Your devices
        </Button>
      </div>
    </Stack>
  );
}

import type { PushPrefs, PushStatus } from '@conch/protocol';
import {
  AddToHomeScreen,
  Button,
  Callout,
  NotifyThisDevice,
  NotifyTopics,
  SettingsSubpages,
  Skeleton,
  Stack,
  Text,
  toast,
  type NotifyState,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { DEVICES_FOCUS } from '../auth/focus';
import { Section } from '../settings/Section';
import { useSubpage } from '../settings/subpages';
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

/** Whether this browser still has the subscription Conch knows it by. */
function hereQuery(publicKey: string) {
  return {
    queryKey: pushKeys.here(publicKey),
    // A browser that can't say (its worker gone) has nothing: turning it on makes one.
    queryFn: async () => matches(await current().catch(() => null), publicKey),
    staleTime: 15_000,
  };
}

/** Each finishes “Tell me when”. */
const TOPICS: { key: Exclude<keyof PushPrefs, 'previews'>; label: string }[] = [
  { key: 'approvals', label: 'It needs you' },
  { key: 'replies', label: 'An answer is ready' },
  { key: 'routines', label: 'A routine runs' },
  { key: 'tasks', label: 'A task finishes' },
  { key: 'devices', label: 'A device asks to sign in' },
  { key: 'updates', label: 'There’s a new version' },
];

/** This device's state, from the browser and from Conch. */
function stateOf(status: PushStatus, subscribed: boolean): NotifyState {
  const support = pushSupport();
  if (support === 'install') return 'install';
  if (support !== 'ok') return 'unsupported';
  if (permission() === 'denied') return 'blocked';
  return subscribed && status.devices.some((d) => d.current) ? 'on' : 'off';
}

/**
 * Settings → Notifications (ADR 0027): this device, one switch, whether they
 * say what they're about, and a row to what it's told about — Topics, a page
 * of its own (`/settings/notifications/topics`). Which other devices get
 * them, and stopping one, is in Settings → Devices, beside each device.
 */
export function NotificationsTab() {
  const { page, open } = useSubpage('notifications');
  const push = usePush();
  const status = push.data;
  // Asking the browser takes a moment: hold the card until both have answered,
  // so the switch opens as it is, never off and then on.
  const asks = pushSupport() === 'ok';
  const here = useQuery({
    ...hereQuery(status?.publicKey ?? ''),
    enabled: Boolean(status) && asks,
  });
  const known = status && (!asks || here.data !== undefined);
  const subscribed = here.data ?? false;
  if (page === 'topics')
    return (
      <SettingsSubpages page={page}>
        <Section title="Topics" description="What this device tells you about.">
          {known ? (
            <Topics status={status} subscribed={subscribed} />
          ) : (
            <Skeleton shape="block" height="14rem" />
          )}
        </Section>
      </SettingsSubpages>
    );
  return (
    <SettingsSubpages page={page}>
      <Stack gap={8}>
        <Section title="Notifications">
          {known ? (
            <ThisDevice
              status={status}
              subscribed={subscribed}
              onOpenTopics={() => open('topics')}
            />
          ) : push.isError ? (
            <Callout
              tone="danger"
              title="Couldn’t load notifications"
              action={
                <Button size="sm" variant="surface" onClick={() => void push.refetch()}>
                  Try again
                </Button>
              }
            >
              {push.error instanceof ApiError ? push.error.message : 'Conch didn’t answer.'}
            </Callout>
          ) : (
            <Skeleton shape="block" height="5rem" />
          )}
        </Section>
        {status && <Elsewhere status={status} />}
      </Stack>
    </SettingsSubpages>
  );
}

/** Saving one of this device's choices: on screen at once, put back if it didn't save. */
function usePrefer(status: PushStatus) {
  const client = useQueryClient();
  const put = (next: PushStatus) => client.setQueryData(pushKeys.status, next);
  const mine = status.devices.find((d) => d.current);
  return async (key: keyof PushPrefs, value: boolean) => {
    if (!mine) return;
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
}

/** What this device is told about, one switch apiece (Notifications → Topics). */
function Topics({ status, subscribed }: { status: PushStatus; subscribed: boolean }) {
  const prefer = usePrefer(status);
  const prefs = status.devices.find((d) => d.current)?.prefs;
  if (stateOf(status, subscribed) !== 'on' || !prefs)
    return (
      <Text size="sm" tone="muted">
        Turn notifications on for this device first, in Notifications.
      </Text>
    );
  return (
    <NotifyTopics
      topics={TOPICS.map((t) => ({ id: t.key, label: t.label, on: prefs[t.key] }))}
      onTopicChange={(id, on) => {
        const topic = TOPICS.find((t) => t.key === id);
        if (topic) void prefer(topic.key, on);
      }}
    />
  );
}

function ThisDevice({
  status,
  subscribed,
  onOpenTopics,
}: {
  status: PushStatus;
  subscribed: boolean;
  onOpenTopics: () => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  // What to change in the browser first; it stays on the card while they do it.
  const [problem, setProblem] = useState<string>();

  const setSubscribed = (on: boolean) => client.setQueryData(pushKeys.here(status.publicKey), on);
  const put = (next: PushStatus) => client.setQueryData(pushKeys.status, next);
  const mine = status.devices.find((d) => d.current);
  const state = stateOf(status, subscribed);
  const prefs = mine?.prefs;
  const topics = useMemo(
    () => prefs && TOPICS.map((t) => ({ id: t.key, label: t.label, on: prefs[t.key] })),
    [prefs],
  );

  const change = async (on: boolean) => {
    setBusy(true);
    setProblem(undefined);
    try {
      if (on) {
        put(await pushApi.subscribe(await subscribe(status.publicKey)));
        setSubscribed(true);
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

  const prefer = usePrefer(status);

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

  return (
    <NotifyThisDevice
      state={state}
      busy={busy}
      onChange={(on) => void change(on)}
      topics={state === 'on' ? topics : undefined}
      onOpenTopics={onOpenTopics}
      previews={prefs?.previews}
      onPreviewsChange={(on) => void prefer('previews', on)}
      onTest={() => void test()}
      testing={testing}
      detail={
        pushSupport() === 'insecure'
          ? 'Needs Conch’s secure (https) address. Add your phone in Devices to get one.'
          : state === 'off'
            ? problem
            : undefined
      }
    >
      {state === 'install' ? <AddToHomeScreen /> : undefined}
    </NotifyThisDevice>
  );
}

/** The other devices: a line, and the way to them. */
function Elsewhere({ status }: { status: PushStatus }) {
  const openSettings = useUi((s) => s.openSettings);
  const others = status.devices.filter((d) => !d.current);
  return (
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
        onClick={() => openSettings('access', DEVICES_FOCUS)}
      >
        Your devices
      </Button>
    </div>
  );
}

import {
  isStaleDevice,
  type AccessSettings,
  type DeviceInfo,
  type DeviceRequest,
  type PushDevice,
  type SessionInfo,
} from '@conch/protocol';
import {
  Accordion,
  AlertDialog,
  Badge,
  Button,
  Callout,
  CopyButton,
  DeviceList,
  DeviceRequests,
  Dialog,
  NotifiedDevices,
  QRCode,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, QrCode, Terminal, Wifi } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, api } from '../../api/client';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { forgetDrafts } from '../chat/composer';
import { pushApi, pushKeys } from '../notifications/api';
import { unsubscribe } from '../notifications/browser';
import { usePush } from '../notifications/NotificationsTab';
import { PhoneSetup } from '../phone/PhoneSetup';
import { Section } from '../settings/Section';
import {
  fail,
  isLocalPage,
  reveal,
  useAccess,
  useApply,
  type Focus as AccessFocus,
  type Guard,
} from './access';
import { ADD_DEVICE_FOCUS, DEVICES_FOCUS, REACH_FOCUS } from './focus';
import styles from './Security.module.css';
import { applySignedIn } from './signedIn';
import { useCountdown } from './useCountdown';
import { useVerify } from './useVerify';

/**
 * Settings → Access → Devices (ADR 0024, ADR 0027): the phones, tablets and
 * browsers signed in to Conch, which of them get notifications, approving new
 * ones, adding your phone, and the ways a phone can reach this computer. The
 * sections above it on Access keep how you sign in; this is who's in.
 */

type Focus = AccessFocus<'devices' | 'reach'>;

// ── Devices ────────────────────────────────────────────────────────────────

const via: Record<SessionInfo['via'], string> = {
  password: 'Signed in with your password',
  key: 'Signed in with an access key',
  pairing: 'Added with a sign-in link',
  setup: 'Set up sign-in',
  passkey: 'Signed in with a passkey',
  hello: 'Signed in when Conch was made yours',
};

function AddDevice({ access, guard }: { access: AccessSettings; guard: Guard }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: number }>();
  const choices = isLocalPage() ? access.urls : [window.location.origin, ...access.urls];
  const secure = choices.some((url) => url.startsWith('https:'));
  // Not encrypted (the same Wi-Fi): only when you choose it over setting up a secure address.
  const [plain, setPlain] = useState(false);
  const [picked, setBase] = useState<string>();
  // A secure address that just came on is the one offered, until you pick another.
  const base =
    picked && choices.includes(picked)
      ? picked
      : (choices.find((u) => u.startsWith('https:')) ?? choices[0]);
  const left = useCountdown(code?.expiresAt);
  const link = code && base ? `${base}/#pair=${code.code}` : undefined;

  const start = async () => {
    setCode(undefined);
    try {
      const ok = await guard(async () => setCode(await api.createPairing()));
      if (ok) setOpen(true);
    } catch (error) {
      fail(error);
    }
  };

  // "Add your phone" from Notifications and ⌘K, and Repair everything's "Set it up", open it here.
  const focus = useUi((s) => s.settingsFocus);
  const opened = useRef(false);
  useEffect(() => {
    if (focus !== ADD_DEVICE_FOCUS || opened.current) return;
    opened.current = true;
    useUi.setState({ settingsFocus: undefined });
    void start().finally(() => (opened.current = false));
  });

  return (
    <>
      <Button variant="surface" leadingIcon={<QrCode />} onClick={() => void start()}>
        Add a device
      </Button>
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setCode(undefined);
        }}
      >
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Add a device</Dialog.Title>
            <Dialog.Description>
              Point your phone’s camera at the code. It signs that device in — no typing.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            {!secure && !plain ? (
              <Stack gap={4}>
                <Text tone="muted">
                  First, an encrypted way for your phone to reach this computer. It takes a minute,
                  once.
                </Text>
                <PhoneSetup />
                {choices.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setPlain(true)}>
                    Use this Wi-Fi’s address instead (not encrypted)
                  </Button>
                )}
              </Stack>
            ) : link && left > 0 ? (
              <Stack gap={4} align="center">
                <QRCode value={link} label="Sign-in code for your phone" size={216} />
                {choices.length > 1 && (
                  <Select value={base} onValueChange={setBase} aria-label="Address">
                    {choices.map((url) => (
                      <Select.Item key={url} value={url}>
                        {url}
                      </Select.Item>
                    ))}
                  </Select>
                )}
                <div className={styles.link}>
                  <code>{link.replace(/pair=.*/, 'pair=…')}</code>
                  <CopyButton value={link} label="Copy link" />
                </div>
                <Text size="sm" tone="muted" align="center">
                  Works once, for the next {Math.floor(left / 60)}:
                  {String(left % 60).padStart(2, '0')}. Whoever opens it is signed in, so keep it to
                  yourself.
                </Text>
                {base?.startsWith('http:') && (
                  <Callout tone="warning">
                    This address isn’t encrypted. Prefer a Tailscale (https) address.
                  </Callout>
                )}
              </Stack>
            ) : (
              <Stack gap={3} align="center">
                <Text tone="muted">This code has expired.</Text>
                <Button variant="surface" onClick={() => void start()}>
                  Make a new one
                </Button>
              </Stack>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="ghost">Done</Button>
            </Dialog.Close>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

const approvedHow: Record<NonNullable<DeviceInfo['approvedHow']>, string> = {
  'this-computer': 'approved on this computer',
  terminal: 'approved in the terminal',
  settings: 'approved in Settings',
  link: 'added with a sign-in link',
  'already-signed-in': 'approved when approval was turned on',
  passkey: 'let in by its passkey',
  hello: 'set Conch up',
  device: 'approved from another device',
};

function deviceMeta(d: DeviceInfo, approval: boolean): string {
  const parts = [
    d.current
      ? 'Signed in now'
      : d.signedIn
        ? `${d.script ? 'Used' : 'Signed in'} · active ${relativeTime(d.lastSeenAt)}`
        : `Signed out · last seen ${relativeTime(d.lastSeenAt)}`,
    !d.current && d.via && !approval && via[d.via].replace('Signed in with', 'with'),
    approval &&
      d.approvedHow &&
      (d.approvedHow === 'device' && d.approvedBy
        ? `approved from ${d.approvedBy}`
        : approvedHow[d.approvedHow]),
    !d.current && d.address && `from ${d.address}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

function requestMeta(r: DeviceRequest): string {
  const what = r.script
    ? `with the key “${r.keyName ?? '?'}”`
    : r.via === 'key'
      ? `with the access key “${r.keyName ?? '?'}”`
      : 'with your password';
  return [r.address && `From ${r.address}`, what, relativeTime(r.createdAt)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Approve new devices, on or off. On is extra protection, so any device may
 * turn it on. Off takes it away, so only this computer can: elsewhere the
 * switch says where to do it.
 */
function ApprovalSwitch({ access, guard }: { access: AccessSettings; guard: Guard }) {
  const apply = useApply();
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const { on, here } = access.approval;

  const set = async (next: boolean) => {
    setBusy(true);
    try {
      const done = await guard(async () => apply(await api.setApproval(next)));
      if (done)
        toast.success(
          next ? 'New devices now need your approval' : 'No longer approving new devices',
        );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.approval} data-on={on || undefined}>
      <Switch
        checked={on}
        disabled={busy || (on && !here)}
        onCheckedChange={(next) => (next ? void set(true) : setConfirmOff(true))}
        label="Approve new devices"
        description={
          on
            ? 'A new device waits for your approval, from a device you’re signed in on or this computer. A passkey lets its own device in.'
            : 'Someone who learns your password still can’t get in until you approve their device.'
        }
      />
      {on && !here && (
        <Text size="xs" tone="muted" className={styles.approvalNote}>
          To turn this off, use the computer running Conch, or run <code>conch devices off</code>{' '}
          there.
        </Text>
      )}
      <AlertDialog.Root open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialog.Content>
          <AlertDialog.Title>Stop approving new devices?</AlertDialog.Title>
          <AlertDialog.Description>
            Anyone with your password or access key could then sign in from a new device. Devices
            you approved are remembered, in case you turn it back on.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep approving</AlertDialog.Cancel>
            <AlertDialog.Action onClick={() => void set(false)}>Turn off</AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}

function DevicesSection({
  access,
  guard,
  focus,
  push,
  onStopNotifications,
}: {
  access: AccessSettings;
  guard: Guard;
  focus?: Focus;
  /** Which devices get notifications, by the device they belong to. */
  push: PushDevice[];
  onStopNotifications: (device: PushDevice) => void;
}) {
  const client = useQueryClient();
  const apply = useApply();
  const ref = useRef<HTMLElement>(null);
  const [removing, setRemoving] = useState<DeviceInfo>();
  const [busy, setBusy] = useState<string>();
  const approval = access.approval.on;
  const others = access.sessions.filter((s) => !s.current).length;

  useEffect(() => {
    if (focus?.place !== 'devices') return;
    focus.done();
    const section = ref.current;
    reveal(
      section,
      section?.querySelector<HTMLElement>('[aria-label="Waiting for your approval"] button') ??
        section?.querySelector<HTMLElement>('button[role="switch"]'),
    );
  }, [focus]);

  const approve = async (code: string, device: string) => {
    setBusy(code);
    try {
      const done = await guard(async () => apply(await api.approveDevice(code)));
      if (done) toast.success(`Approved ${device}`);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(undefined);
    }
  };

  const reject = (code: string, device: string) =>
    void api
      .rejectDevice(code)
      .then((s) => {
        apply(s);
        toast(`Turned down ${device}`, {
          description: 'If it wasn’t you, someone knows your password or key: change it.',
        });
      })
      .catch(fail);

  return (
    <Section
      ref={ref}
      title="Devices"
      description={
        approval
          ? 'A device you don’t approve can’t get in, even with your password.'
          : 'Sign out or remove anything you don’t recognise.'
      }
    >
      <Stack gap={5}>
        <ApprovalSwitch access={access} guard={guard} />
        {access.requests.length > 0 && (
          <DeviceRequests
            requests={access.requests.map((r) => ({
              code: r.code,
              device: r.device,
              kind: r.kind,
              meta: requestMeta(r),
              rejected: r.rejected,
            }))}
            canApprove={access.approval.canApprove}
            hint="Approve it on a device that’s already let in, or on the computer running Conch:"
            commandFor={(code) => `conch devices approve ${code}`}
            busy={busy}
            onApprove={(r) => void approve(r.code, r.device)}
            onReject={(r) => reject(r.code, r.device)}
          />
        )}
        <DeviceList
          label="Devices"
          devices={access.devices.map((d) => {
            const told = push.find((p) => p.deviceId === d.id);
            return {
              id: d.id,
              name: d.name,
              kind: d.kind,
              current: d.current,
              signedIn: d.signedIn,
              stale: approval && isStaleDevice(d),
              notified: Boolean(told),
              meta: [deviceMeta(d, approval), told?.problem].filter(Boolean).join(' · '),
            };
          })}
          onStopNotifications={(device) => {
            const told = push.find((p) => p.deviceId === device.id);
            if (told) onStopNotifications(told);
          }}
          onSignOut={(device) =>
            void (
              device.current
                ? api.signOut().then(async () => {
                    forgetDrafts();
                    applySignedIn(client, await api.auth());
                  })
                : api.signOutDevice(device.id).then((s) => {
                    apply(s);
                    toast.success(`Signed out ${device.name}`);
                  })
            ).catch(fail)
          }
          onRemove={(device) => setRemoving(access.devices.find((d) => d.id === device.id))}
        />
        <div className={styles.inline}>
          <AddDevice access={access} guard={guard} />
          {others > 0 && (
            <Button
              variant="ghost"
              tone="danger"
              onClick={() =>
                void api
                  .revokeOtherSessions()
                  .then((s) => {
                    apply(s);
                    toast.success('Signed out everywhere else');
                  })
                  .catch(fail)
              }
            >
              Sign out everywhere else
            </Button>
          )}
        </div>
      </Stack>
      <AlertDialog.Root open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(undefined)}>
        <AlertDialog.Content>
          <AlertDialog.Title>Remove {removing?.name}?</AlertDialog.Title>
          <AlertDialog.Description>
            {approval
              ? 'It will be signed out, and will need your approval to sign in again.'
              : 'It will be signed out, and forgotten.'}
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                const device = removing;
                if (!device) return;
                void api
                  .removeDevice(device.id)
                  .then((s) => {
                    apply(s);
                    toast.success(`Removed ${device.name}`);
                  })
                  .catch(fail);
              }}
            >
              Remove
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Section>
  );
}

// ── Reaching Conch from other devices ─────────────────────────────────────

function Command({ children }: { children: string }) {
  return (
    <div className={styles.command}>
      <code>{children}</code>
      <CopyButton value={children} label="Copy command" />
    </div>
  );
}

function ReachSection({ access, focus }: { access: AccessSettings; focus?: Focus }) {
  const { tailscale } = access;
  const [open, setOpen] = useState(tailscale ? '' : 'tailscale');
  const ref = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (focus?.place === 'reach' && open !== 'tailscale') setOpen('tailscale');

  useEffect(() => {
    if (focus?.place !== 'reach') return;
    focus.done();
    reveal(ref.current, trigger.current);
  }, [focus]);

  return (
    <Section
      ref={ref}
      title="Use Conch on your phone"
      description={
        tailscale
          ? `Tailscale is running — your devices can reach Conch at ${tailscale}.`
          : access.exposure === 'network'
            ? 'Conch is listening on your network.'
            : 'Right now only this computer can reach Conch. Pick a way to connect:'
      }
    >
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        <Accordion.Item value="tailscale">
          <Accordion.Trigger
            ref={trigger}
            icon={<Globe />}
            meta={
              <Badge size="sm" tone="success" variant="soft">
                Recommended · Encrypted
              </Badge>
            }
          >
            Tailscale — anywhere, privately
          </Accordion.Trigger>
          <Accordion.Content>
            <ol className={styles.steps}>
              <li>
                Install Tailscale on this computer and your phone, and sign in to both:{' '}
                <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                  tailscale.com/download
                </a>
              </li>
              <li>
                Press <strong>Add a device</strong> above. Conch turns on its secure address for
                you, then shows the code for your phone.
              </li>
            </ol>
            <Text size="sm" tone="muted">
              Prefer the terminal? <code>{`tailscale serve --bg ${access.port}`}</code> does the
              same.
            </Text>
            <Text size="sm" tone="muted">
              Only your own devices can reach it, over an encrypted connection. Nothing is opened to
              the internet.
            </Text>
          </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="wifi">
          <Accordion.Trigger
            icon={<Wifi />}
            meta={
              <Badge size="sm" tone="warning" variant="soft">
                Not encrypted
              </Badge>
            }
          >
            Same Wi-Fi only
          </Accordion.Trigger>
          <Accordion.Content>
            <Stack gap={3}>
              <Callout tone="warning">
                Anyone on the same network could read your conversations and your password as it’s
                sent. Only do this on a network you trust, like your home.
              </Callout>
              <Text size="sm">Stop Conch, then start it from the Conch folder with:</Text>
              <Command>pnpm start:network</Command>
            </Stack>
          </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="ssh">
          <Accordion.Trigger icon={<Terminal />} meta={<Badge size="sm">For developers</Badge>}>
            SSH tunnel
          </Accordion.Trigger>
          <Accordion.Content>
            <Stack gap={3}>
              <Text size="sm">From another computer that can SSH into this one:</Text>
              <Command>{`ssh -N -L ${access.port}:localhost:${access.port} you@this-computer`}</Command>
              <Text size="sm" tone="muted">
                Then open http://localhost:{access.port} there. Encrypted by SSH.
              </Text>
            </Stack>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </Section>
  );
}

// ── The place ──────────────────────────────────────────────────────────────

export function DevicesTab() {
  const access = useAccess();
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const client = useQueryClient();
  const { data: push } = usePush();
  const openSettings = useUi((s) => s.openSettings);
  const settingsFocus = useUi((s) => s.settingsFocus);
  const method = access.data?.method;
  // Opened to a part of it: a device asking, ⌘K's "Devices", a fix's "Use Conch on your phone".
  // The part brings itself into view once it's drawn, and says it's done.
  const asked =
    method && method !== 'none' && settingsFocus === DEVICES_FOCUS
      ? 'devices'
      : method && settingsFocus === REACH_FOCUS
        ? 'reach'
        : undefined;
  const focus = useMemo<Focus | undefined>(
    () =>
      asked
        ? { place: asked, done: () => useUi.setState({ settingsFocus: undefined }) }
        : undefined,
    [asked],
  );
  useEffect(() => {
    // A phone signs in, so a sign-in comes first: Access asks for one above (AccessTab).
    // No devices to show yet (no sign-in): nothing to bring into view.
    if (settingsFocus === DEVICES_FOCUS && method === 'none')
      useUi.setState({ settingsFocus: undefined });
  }, [settingsFocus, method]);

  const stop = (device: PushDevice) =>
    void pushApi
      .remove(device.id)
      .then(async (next) => {
        client.setQueryData(pushKeys.status, next);
        if (device.current) await unsubscribe().catch(() => undefined);
        toast.success(`No more notifications on ${device.name}`);
      })
      .catch(fail);

  if (access.isPending)
    return (
      <Stack gap={4}>
        <Skeleton shape="block" height={160} />
        <Skeleton shape="block" height={200} />
      </Stack>
    );
  if (access.isError)
    return (
      <Callout tone="danger" title="Couldn’t load your devices">
        {access.error instanceof ApiError ? access.error.message : 'Try again in a moment.'}
      </Callout>
    );

  const data = access.data;
  const told = push?.devices ?? [];
  // Notified, but not one of the devices above: this computer with no sign-in, a browser not yet a device.
  const others = told.filter((p) => !p.deviceId || !data.devices.some((d) => d.id === p.deviceId));

  return (
    <Stack gap={8}>
      {data.method === 'none' ? (
        <Section
          title="Devices"
          description="Only this computer can open Conch. Add your phone, and it signs in here."
        >
          <div>
            <Button
              variant="surface"
              leadingIcon={<QrCode />}
              onClick={() => openSettings('access', ADD_DEVICE_FOCUS)}
            >
              Add your phone
            </Button>
          </div>
        </Section>
      ) : (
        <DevicesSection
          access={data}
          guard={guard}
          focus={focus}
          push={told}
          onStopNotifications={stop}
        />
      )}
      {others.length > 0 && (
        <Section title="Also told" description="Notifications go here too.">
          <NotifiedDevices
            devices={others.map((d) => ({
              id: d.id,
              name: d.name,
              current: d.current,
              problem: d.problem,
              detail: d.lastSentAt
                ? `Last told ${relativeTime(d.lastSentAt)}`
                : 'Not told anything yet',
            }))}
            onRemove={(id) => {
              const device = others.find((d) => d.id === id);
              if (device) stop(device);
            }}
          />
        </Section>
      )}
      <ReachSection access={data} focus={focus} />
      {dialog}
    </Stack>
  );
}

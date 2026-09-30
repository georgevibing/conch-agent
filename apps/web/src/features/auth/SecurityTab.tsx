import {
  checkPassword,
  suggestPassword,
  type AccessMethod,
  type AccessSettings,
  type CreatedKey,
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
  Dialog,
  Field,
  IconButton,
  Input,
  PasswordInput,
  QRCode,
  RadioGroup,
  SecretReveal,
  SecurityCheckup,
  Select,
  Skeleton,
  Stack,
  StrengthMeter,
  Text,
  toast,
  type CheckItem,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  KeyRound,
  Laptop,
  LockKeyhole,
  Plus,
  QrCode,
  ShieldOff,
  Sparkles,
  Terminal,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { HealedSection } from '../settings/HealedSection';
import { Section } from '../settings/Section';
import styles from './Security.module.css';
import { applySignedIn } from './signedIn';
import { useCountdown } from './useCountdown';
import { useVerify } from './useVerify';

type Guard = ReturnType<typeof useVerify>['guard'];

const isLocalPage = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

function useAccess() {
  return useQuery({ queryKey: keys.access, queryFn: api.access, staleTime: 10_000 });
}

function useApply() {
  const client = useQueryClient();
  return (settings: AccessSettings) => {
    client.setQueryData(keys.access, settings);
    void client.invalidateQueries({ queryKey: keys.auth });
  };
}

const fail = (error: unknown) => toast.error((error as Error).message);

// ── Sign-in method ─────────────────────────────────────────────────────────

const methods: { value: AccessMethod; label: string; description: string; icon: ReactNode }[] = [
  {
    value: 'password',
    label: 'Password',
    description: 'Easiest on your own devices. Your browser can remember it for you.',
    icon: <LockKeyhole />,
  },
  {
    value: 'key',
    label: 'Access key',
    description: 'A long key you paste once per device. Good for scripts, too.',
    icon: <KeyRound />,
  },
  {
    value: 'none',
    label: 'No sign-in',
    description: 'Only this computer can open Conch.',
    icon: <ShieldOff />,
  },
];

function PasswordForm({
  access,
  guard,
  onDone,
}: {
  access: AccessSettings;
  guard: Guard;
  onDone?: () => void;
}) {
  const apply = useApply();
  const [username, setUsername] = useState(access.username ?? access.suggestedUsername);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = checkPassword(password, { username });
  const switching = access.method !== 'password';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!check.ok) return;
    setBusy(true);
    try {
      const done = await guard(async () => apply(await api.setPassword(username, password)));
      if (done) {
        toast.success(switching ? 'Password sign-in is on' : 'Password changed');
        setPassword('');
        onDone?.();
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} aria-label="Choose a password">
      <Stack gap={4}>
        <Field>
          <Field.Label>Username</Field.Label>
          <Input
            name="username"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field invalid={password.length > 0 && !check.ok}>
          <Field.Label>{switching ? 'Password' : 'New password'}</Field.Label>
          <PasswordInput
            name="new-password"
            autoComplete="new-password"
            value={password}
            revealed={revealed}
            onRevealedChange={setRevealed}
            onChange={(e) => {
              setPassword(e.target.value);
              setSuggested(false);
            }}
            required
          />
          <StrengthMeter
            score={check.score}
            label={check.label}
            message={
              suggested
                ? 'Strong password. Save it in your password manager — your browser will offer to.'
                : check.message
            }
            empty={!password}
            className={styles.meter}
          />
        </Field>
        <div className={styles.formActions}>
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<Sparkles />}
            onClick={() => {
              setPassword(suggestPassword());
              setRevealed(true);
              setSuggested(true);
            }}
          >
            Suggest a strong one
          </Button>
          <Button type="submit" loading={busy} disabled={!check.ok || !username.trim()}>
            {switching ? 'Turn on password sign-in' : 'Change password'}
          </Button>
        </div>
        {switching && access.method === 'key' && (
          <Text size="sm" tone="muted">
            Your access keys will stop working and other devices will be signed out.
          </Text>
        )}
      </Stack>
    </form>
  );
}

function NewKey({ access, guard }: { access: AccessSettings; guard: Guard }) {
  const client = useQueryClient();
  const [name, setName] = useState(access.keys.length ? '' : 'My devices');
  const [created, setCreated] = useState<CreatedKey>();
  const [busy, setBusy] = useState(false);
  const switching = access.method !== 'key';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await guard(async () => {
        const key = await api.createKey(name.trim());
        setCreated(key);
        void client.invalidateQueries({ queryKey: keys.access });
        void client.invalidateQueries({ queryKey: keys.auth });
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Stack gap={3}>
        <SecretReveal secret={created.key} title={`Access key “${created.info.name}”`} />
        <Button variant="surface" onClick={() => setCreated(undefined)} className={styles.end}>
          I’ve saved it
        </Button>
      </Stack>
    );
  }

  return (
    <form className={styles.inline} onSubmit={(e) => void submit(e)} aria-label="New access key">
      <Field className={styles.grow}>
        <Field.Label>Name</Field.Label>
        <Input
          value={name}
          maxLength={40}
          placeholder="e.g. iPhone, work laptop"
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" leadingIcon={<Plus />} loading={busy} disabled={!name.trim()}>
        {switching ? 'Create key & turn on' : 'Create key'}
      </Button>
      {switching && access.method === 'password' && (
        <Text size="sm" tone="muted" className={styles.full}>
          Your password will stop working and other devices will be signed out.
        </Text>
      )}
    </form>
  );
}

function KeyList({ access }: { access: AccessSettings }) {
  const apply = useApply();
  return (
    <ul className={styles.keys} aria-label="Access keys">
      {access.keys.map((key) => (
        <li key={key.id} className={styles.key}>
          <KeyRound aria-hidden className={styles.keyIcon} />
          <div className={styles.grow}>
            <Text as="p" size="sm" weight="medium">
              {key.name}{' '}
              <Text as="span" size="xs" tone="subtle" className={styles.mono}>
                …{key.hint}
              </Text>
            </Text>
            <Text as="p" size="xs" tone="subtle">
              Created {relativeTime(key.createdAt)} ·{' '}
              {key.lastUsedAt ? `last used ${relativeTime(key.lastUsedAt)}` : 'never used'}
            </Text>
          </div>
          <IconButton
            label={`Revoke ${key.name}`}
            tone="danger"
            onClick={() =>
              void api
                .revokeKey(key.id)
                .then((s) => {
                  apply(s);
                  toast.success(`Revoked “${key.name}”`);
                })
                .catch(fail)
            }
          >
            <Trash2 />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

function TurnOff({ guard }: { guard: Guard }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  return (
    <Stack gap={3}>
      <Text size="sm" tone="muted">
        Only this computer will be able to open Conch, and every other device will be signed out. If
        anyone else uses this computer, they could use your assistant.
      </Text>
      <Button
        tone="danger"
        variant="soft"
        leadingIcon={<ShieldOff />}
        onClick={() => setConfirm(true)}
        className={styles.start}
      >
        Turn off sign-in
      </Button>
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content>
          <AlertDialog.Title>Turn off sign-in?</AlertDialog.Title>
          <AlertDialog.Description>
            Your password or access keys will be deleted and every device signed out. Other devices
            won’t be able to use Conch until you turn sign-in back on.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it on</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() =>
                void guard(async () => {
                  await api.disableSignIn();
                  applySignedIn(client, await api.auth());
                  toast('Sign-in is off');
                }).catch(fail)
              }
            >
              Turn off
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Stack>
  );
}

function SignInSection({ access, guard }: { access: AccessSettings; guard: Guard }) {
  const [choice, setChoice] = useState<AccessMethod>(
    access.method === 'none' ? 'password' : access.method,
  );
  const [changing, setChanging] = useState(false);
  const current = choice === access.method;

  return (
    <Section
      title="How you sign in"
      description={
        access.method === 'none'
          ? 'Right now anyone using this computer can open Conch. Choose a way to sign in — you’ll need it to use Conch on your phone, too.'
          : 'Every device, including this one, has to sign in.'
      }
    >
      <Stack gap={5}>
        <RadioGroup
          variant="card"
          aria-label="Sign-in method"
          value={choice}
          onValueChange={(v) => {
            setChoice(v as AccessMethod);
            setChanging(false);
          }}
          className={styles.methods}
        >
          {methods
            .filter((m) => m.value !== 'none' || access.method !== 'none')
            .map((m) => (
              <RadioGroup.Item
                key={m.value}
                value={m.value}
                label={
                  <span className={styles.methodLabel}>
                    {m.label}
                    {m.value === access.method && (
                      <Badge size="sm" tone="success" variant="soft">
                        On
                      </Badge>
                    )}
                  </span>
                }
                description={m.description}
                icon={m.icon}
              />
            ))}
        </RadioGroup>

        {choice === 'password' &&
          (current && !changing ? (
            <div className={styles.inline}>
              <Text size="sm" className={styles.grow}>
                Signed in as <strong>{access.username}</strong>
              </Text>
              <Button variant="surface" onClick={() => setChanging(true)}>
                Change password
              </Button>
            </div>
          ) : (
            <PasswordForm access={access} guard={guard} onDone={() => setChanging(false)} />
          ))}

        {choice === 'key' && (
          <Stack gap={4}>
            {current && <KeyList access={access} />}
            <NewKey access={access} guard={guard} />
          </Stack>
        )}

        {choice === 'none' && access.method !== 'none' && <TurnOff guard={guard} />}
      </Stack>
    </Section>
  );
}

// ── Devices ────────────────────────────────────────────────────────────────

const via: Record<SessionInfo['via'], string> = {
  password: 'Signed in with your password',
  key: 'Signed in with an access key',
  pairing: 'Added with a sign-in link',
  setup: 'Set up sign-in',
};

function AddDevice({ access, guard }: { access: AccessSettings; guard: Guard }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: number }>();
  const choices = isLocalPage() ? access.urls : [window.location.origin, ...access.urls];
  const [base, setBase] = useState<string | undefined>(choices[0]);
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
            {!choices.length ? (
              <Callout tone="info" title="Your phone can’t reach this computer yet">
                Set up Tailscale first (see “Use Conch on your phone” below), then come back.
              </Callout>
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

function DevicesSection({ access, guard }: { access: AccessSettings; guard: Guard }) {
  const client = useQueryClient();
  const apply = useApply();
  const others = access.sessions.filter((s) => !s.current).length;
  return (
    <Section title="Signed-in devices" description="Sign out anything you don’t recognise.">
      <Stack gap={4}>
        <DeviceList
          devices={access.sessions.map((s) => ({
            id: s.id,
            name: s.device,
            kind: s.kind,
            current: s.current,
            meta: `${via[s.via]} · ${s.current ? 'now' : `active ${relativeTime(s.lastSeenAt)}`}`,
          }))}
          onSignOut={(device) =>
            void (
              device.current
                ? api.signOut().then(async () => applySignedIn(client, await api.auth()))
                : api.revokeSession(device.id).then((s) => {
                    apply(s);
                    toast.success(`Signed out ${device.name}`);
                  })
            ).catch(fail)
          }
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

function ReachSection({ access }: { access: AccessSettings }) {
  const { tailscale } = access;
  return (
    <Section
      title="Use Conch on your phone"
      description={
        tailscale
          ? `Tailscale is running — your devices can reach Conch at ${tailscale}.`
          : access.exposure === 'network'
            ? 'Conch is listening on your network.'
            : 'Right now only this computer can reach Conch. Pick a way to connect:'
      }
    >
      <Accordion type="single" collapsible defaultValue={tailscale ? undefined : 'tailscale'}>
        <Accordion.Item value="tailscale">
          <Accordion.Trigger
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
                On this computer, run:
                <Command>{`tailscale serve --bg ${access.port}`}</Command>
              </li>
              <li>
                Restart Conch, then use <strong>Add a device</strong> above to sign your phone in.
              </li>
            </ol>
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

// ── Tab ────────────────────────────────────────────────────────────────────

export function SecurityTab() {
  const access = useAccess();
  const openSettings = useUi((s) => s.openSettings);
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');

  if (access.isPending)
    return (
      <Stack gap={4}>
        <Skeleton shape="block" height={120} />
        <Skeleton shape="block" height={220} />
      </Stack>
    );
  if (access.isError) {
    // A gateway started before this version doesn't know these routes yet.
    const stale = access.error instanceof ApiError && access.error.status === 404;
    return stale ? (
      <Callout tone="info" title="Restart Conch to finish updating">
        The page is up to date, but the Conch gateway on this computer is still running the previous
        version. Stop it (Ctrl+C in its terminal) and run <code>pnpm start</code> again.
      </Callout>
    ) : (
      <Callout tone="danger" title="Couldn’t load security settings">
        {access.error instanceof ApiError ? access.error.message : 'Try again in a moment.'}
      </Callout>
    );
  }

  const data = access.data;
  const items: CheckItem[] = data.checkup.map((item) => ({
    ...item,
    ...(item.id === 'full-trust' && {
      action: (
        <Button size="sm" variant="surface" onClick={() => openSettings('models')}>
          Change
        </Button>
      ),
    }),
  }));

  return (
    <Stack gap={8}>
      <Section title="Security" description="Keep Conch — and this computer — safe.">
        <SecurityCheckup items={items} />
      </Section>
      <HealedSection />
      {/* Re-mount when the method changes so the choice follows it. */}
      <SignInSection key={data.method} access={data} guard={guard} />
      {data.method !== 'none' && <DevicesSection access={data} guard={guard} />}
      <ReachSection access={data} />
      {dialog}
      <Text size="xs" tone="subtle" className={styles.footnote}>
        <Laptop aria-hidden /> Forgot your password? On this computer, run{' '}
        <code>pnpm conch reset</code> in the Conch folder.
      </Text>
    </Stack>
  );
}

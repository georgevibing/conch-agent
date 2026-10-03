import {
  checkPassword,
  isStaleKey,
  suggestPassword,
  type AccessMethod,
  type AccessSettings,
  type CheckupFix,
  type CheckupPlace,
  type CreatedKey,
  type DeviceInfo,
  type DeviceRequest,
  type SessionInfo,
  isStaleDevice,
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
  Field,
  IconButton,
  Input,
  PasskeyList,
  PasswordInput,
  QRCode,
  RadioGroup,
  SecretReveal,
  SecurityCheckup,
  Select,
  Skeleton,
  Stack,
  StrengthMeter,
  Switch,
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
  FingerprintPattern,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { Section } from '../settings/Section';
import { DEVICES_FOCUS, PASSKEYS_FOCUS } from './focus';
import styles from './Security.module.css';
import { createPasskey, passkeyProblem } from './passkey';
import { applySignedIn } from './signedIn';
import { usePasskeyPlatform } from './usePasskeyPlatform';
import { useCountdown } from './useCountdown';
import { useVerify } from './useVerify';
import { PhoneSetup } from '../phone/PhoneSetup';
import { LIVE_DATA_FOCUS, LiveDataSection } from '../artifacts/LiveDataSection';
import { SafetySection } from '../safety/SafetySection';

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

/** A part of this tab a checkup fix can bring you to. */
type Place = Exclude<CheckupPlace, 'models' | 'channels'>;

/** A request to bring one part into view; the part calls `done` once it has. */
interface Focus {
  place: Place;
  done: () => void;
}

/** Bring a section into view and put the keyboard where the fix happens. */
function reveal(section: HTMLElement | null, target: HTMLElement | null | undefined) {
  if (!section) return;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  target?.focus({ preventScroll: true });
}

// ── Sign-in method ─────────────────────────────────────────────────────────

const methods: { value: AccessMethod; label: string; description: string; icon: ReactNode }[] = [
  {
    value: 'passkey',
    label: 'Passkeys only',
    description: 'Touch ID, Windows Hello or Face ID. Nothing to remember, nothing to type.',
    icon: <FingerprintPattern />,
  },
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
          name="key-name"
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
        <li key={key.id} className={styles.key} data-stale={isStaleKey(key) || undefined}>
          <KeyRound aria-hidden className={styles.keyIcon} />
          <div className={styles.grow}>
            <Text as="p" size="sm" weight="medium">
              {key.name}{' '}
              <Text as="span" size="xs" tone="subtle" className={styles.mono}>
                …{key.hint}
              </Text>
              {isStaleKey(key) && (
                <>
                  {' '}
                  <Badge size="sm" tone="warning" variant="soft">
                    Not used in 90 days
                  </Badge>
                </>
              )}
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
                  await applySignedIn(client, await api.auth());
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

function SignInSection({
  access,
  guard,
  focus,
}: {
  access: AccessSettings;
  guard: Guard;
  /** A checkup fix asked for this section: a password to choose, or the keys. */
  focus?: Focus;
}) {
  const [choice, setChoice] = useState<AccessMethod>(
    access.method === 'none' ? 'password' : access.method,
  );
  const [changing, setChanging] = useState(false);
  // The choice follows the method when it changes. Not by re-mounting: a new
  // access key is on screen right then, and it's shown only once.
  const [method, setMethod] = useState(access.method);
  if (method !== access.method) {
    setMethod(access.method);
    setChoice(access.method === 'none' ? 'password' : access.method);
    setChanging(false);
  }
  // A checkup fix asked for a form: show it first, then bring it into view.
  const wanted: AccessMethod | undefined =
    focus?.place === 'keys' ? 'key' : focus?.place === 'sign-in' ? 'password' : undefined;
  if (wanted && choice !== wanted) {
    setChoice(wanted);
    setChanging(false);
  }
  const current = choice === access.method;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus?.place !== 'sign-in' && focus?.place !== 'keys') return;
    focus.done();
    const section = ref.current;
    reveal(
      section,
      focus.place === 'keys'
        ? (section?.querySelector<HTMLElement>('[data-stale] button') ??
            section?.querySelector<HTMLElement>('input[name="key-name"]'))
        : section?.querySelector<HTMLElement>('input[name="new-password"]'),
    );
  }, [focus]);

  return (
    <Section
      ref={ref}
      title="How you sign in"
      description={
        access.method === 'none'
          ? 'Right now anyone using this computer can open Conch. Choose a way to sign in — you’ll need it to use Conch on your phone, too.'
          : access.passkeys.length && access.method !== 'passkey'
            ? 'Every device, including this one, has to sign in. Your passkeys work too.'
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
            // Passkeys only is what you have when your passkeys are the way in; you add them below.
            .filter((m) => m.value !== 'passkey' || access.method === 'passkey')
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

        {choice === 'passkey' && (
          <Text size="sm" tone="muted">
            Your passkeys are the way in. Add one for each device in Passkeys, or choose a password
            here to have both.
          </Text>
        )}

        {choice === 'none' && access.method !== 'none' && <TurnOff guard={guard} />}
      </Stack>
    </Section>
  );
}

// ── Passkeys (ADR 0065) ─────────────────────────────────────────────────────

/** "Added 3 days ago · last used just now · synced". */
function passkeyMeta(p: AccessSettings['passkeys'][number]): string {
  return [
    `Added ${relativeTime(p.createdAt)}`,
    p.lastUsedAt ? `last used ${relativeTime(p.lastUsedAt)}` : 'not used yet',
    p.synced && 'synced to your other devices',
  ]
    .filter(Boolean)
    .join(' · ');
}

function PasskeysSection({
  access,
  guard,
  focus,
}: {
  access: AccessSettings;
  guard: Guard;
  focus?: Focus;
}) {
  const apply = useApply();
  const { platform } = usePasskeyPlatform();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [removing, setRemoving] = useState<{ id: string; name: string }>();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus?.place !== 'passkeys') return;
    focus.done();
    const section = ref.current;
    reveal(section, section?.querySelector<HTMLElement>('button'));
  }, [focus]);

  const add = async () => {
    setAdding(true);
    // A new way in needs a fresh "confirm it's you": ask before the browser's prompt, not after.
    let confirmFirst = !access.verified;
    try {
      const done = await guard(async () => {
        if (confirmFirst) {
          confirmFirst = false;
          throw new ApiError(403, 'verify-required', 'Confirm it’s you to make this change.');
        }
        apply(await api.addPasskey(await createPasskey({ purpose: 'add' })));
      });
      if (done) toast.success('Passkey added. Next time, signing in is a touch.');
    } catch (error) {
      const problem = error instanceof ApiError ? error.message : passkeyProblem(error);
      if (problem) toast.error(problem);
    } finally {
      setAdding(false);
    }
  };

  const keep =
    access.method === 'passkey' && access.passkeys.length === 1
      ? 'It’s your only way in. Add another passkey or a password first.'
      : undefined;

  return (
    <Section
      ref={ref}
      title="Passkeys"
      description={
        access.passkeysHere
          ? 'Sign in with the fingerprint, face or PIN you already use on each device. Nothing to remember, and nothing a fake page can steal.'
          : 'Passkeys work at Conch’s secure address (https://…) or on this computer. Open Conch there to add one.'
      }
    >
      <PasskeyList
        passkeys={access.passkeys.map((p) => ({
          id: p.id,
          name: p.name,
          site: p.rpId,
          meta: passkeyMeta(p),
          here: p.here,
          ...(keep && { keep }),
        }))}
        {...(access.passkeysHere && platform && { platform })}
        adding={adding}
        busy={busy}
        onAdd={() => void add()}
        onRename={(passkey, name) => {
          setBusy(passkey.id);
          void api
            .renamePasskey(passkey.id, name)
            .then(apply)
            .catch(fail)
            .finally(() => setBusy(undefined));
        }}
        onRemove={(passkey) => setRemoving(passkey)}
      />
      <AlertDialog.Root open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(undefined)}>
        <AlertDialog.Content>
          <AlertDialog.Title>Remove {removing?.name}?</AlertDialog.Title>
          <AlertDialog.Description>
            It won’t sign in to Conch any more, and any device signed in with it is signed out.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                const passkey = removing;
                if (!passkey) return;
                setBusy(passkey.id);
                void guard(async () => {
                  apply(await api.removePasskey(passkey.id));
                  toast.success(`Removed ${passkey.name}`);
                })
                  .catch(fail)
                  .finally(() => setBusy(undefined));
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

// ── Devices ────────────────────────────────────────────────────────────────

const via: Record<SessionInfo['via'], string> = {
  password: 'Signed in with your password',
  key: 'Signed in with an access key',
  pairing: 'Added with a sign-in link',
  setup: 'Set up sign-in',
  passkey: 'Signed in with a passkey',
  hello: 'Signed in when Conch was made yours',
};

/** ⌘K, Notifications and Repair everything open Add a device by this name. */
export const ADD_DEVICE_FOCUS = 'add-device';

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
            ? 'A new device has to be approved after it signs in, even with the right password or key: on a device you’re already signed in on, or on this computer. A passkey lets its own device in.'
            : 'Extra protection: someone who learns your password or key still can’t get in until you approve their device from one of yours.'
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
}: {
  access: AccessSettings;
  guard: Guard;
  focus?: Focus;
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
          ? 'What has used Conch. A device you don’t approve can’t get in, even with your password.'
          : 'What has used Conch. Sign out or remove anything you don’t recognise.'
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
          devices={access.devices.map((d) => ({
            id: d.id,
            name: d.name,
            kind: d.kind,
            current: d.current,
            signedIn: d.signedIn,
            stale: approval && isStaleDevice(d),
            meta: deviceMeta(d, approval),
          }))}
          onSignOut={(device) =>
            void (
              device.current
                ? api.signOut().then(async () => applySignedIn(client, await api.auth()))
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

// ── Tab ────────────────────────────────────────────────────────────────────

/**
 * Each checkup finding's one fix. `open` goes where the decision is made;
 * `act` asks the gateway to make the change (only ever towards asking, off
 * or private), confirming it's you first wherever that setting's own route
 * would. Once it works the finding leaves the list and a quiet toast says
 * what changed.
 */
function useCheckupFix(guard: Guard) {
  const client = useQueryClient();
  const apply = useApply();
  const openSettings = useUi((s) => s.openSettings);
  const [focus, setFocus] = useState<Focus>();

  const run = (fix: CheckupFix): Promise<unknown> | undefined => {
    if (fix.kind === 'open') {
      if (fix.place === 'models') openSettings('models');
      else if (fix.place === 'channels') {
        // A page, not a part of Settings: going there leaves Settings.
        window.dispatchEvent(new CustomEvent('conch:navigate', { detail: '/apps?show=talk' }));
      } else setFocus({ place: fix.place, done: () => setFocus(undefined) });
      return undefined;
    }
    return guard(async () => {
      const { done, access } = await api.fixCheckup(fix.action);
      // A refetch that started before the fix (say, after confirming it's you) is already stale.
      await client.cancelQueries({ queryKey: keys.access });
      apply(access);
      // "Ask first" changes the default mode shown in Models & modes.
      void client.invalidateQueries({ queryKey: keys.state });
      toast.success(done);
    }).catch(fail);
  };
  const focusOn = (place: Place) => setFocus({ place, done: () => setFocus(undefined) });
  return { run, focus, focusOn };
}

export function SecurityTab() {
  const access = useAccess();
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const fix = useCheckupFix(guard);
  // Opened to a part of the tab (a device asking, or ⌘K's "Devices").
  const settingsFocus = useUi((s) => s.settingsFocus);
  const loaded = Boolean(access.data);
  const { focusOn } = fix;
  // Your address (ADR 0064) has no section of its own here yet: its fixes start at the top.
  const top = useRef<HTMLElement>(null);
  const addressFocus = fix.focus?.place === 'address' ? fix.focus : undefined;
  useEffect(() => {
    if (!addressFocus) return;
    addressFocus.done();
    reveal(top.current, undefined);
  }, [addressFocus]);
  useEffect(() => {
    if (settingsFocus !== DEVICES_FOCUS || !loaded) return;
    useUi.setState({ settingsFocus: undefined });
    focusOn('devices');
  }, [settingsFocus, loaded, focusOn]);
  useEffect(() => {
    if (settingsFocus !== LIVE_DATA_FOCUS || !loaded) return;
    useUi.setState({ settingsFocus: undefined });
    focusOn('live-data');
  }, [settingsFocus, loaded, focusOn]);
  useEffect(() => {
    if (settingsFocus !== PASSKEYS_FOCUS || !loaded) return;
    useUi.setState({ settingsFocus: undefined });
    focusOn('passkeys');
  }, [settingsFocus, loaded, focusOn]);

  // "Add your phone" with no sign-in yet: a phone signs in with a password, so
  // that comes first, and the code for the phone follows by itself once it's set.
  const method = access.data?.method;
  const addAfterSignIn = useRef(false);
  useEffect(() => {
    if (settingsFocus !== ADD_DEVICE_FOCUS || method !== 'none') return;
    useUi.setState({ settingsFocus: undefined });
    addAfterSignIn.current = true;
    focusOn('sign-in');
    toast('Your phone signs in with a password. Choose one here, and its code comes next.');
  }, [settingsFocus, method, focusOn]);
  useEffect(() => {
    if (!addAfterSignIn.current || !method || method === 'none') return;
    addAfterSignIn.current = false;
    useUi.setState({ settingsFocus: ADD_DEVICE_FOCUS });
  }, [method]);

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
  const items: CheckItem[] = data.checkup.map(({ fix: wire, ...item }) => ({
    ...item,
    ...(wire && { fix: { label: wire.label, kind: wire.kind, onFix: () => fix.run(wire) } }),
  }));

  return (
    <Stack gap={8}>
      <Section ref={top} title="Security" description="Keep Conch — and this computer — safe.">
        <SecurityCheckup items={items} />
      </Section>
      <SafetySection />
      <LiveDataSection focus={fix.focus} />
      <PasskeysSection access={data} guard={guard} focus={fix.focus} />
      <SignInSection access={data} guard={guard} focus={fix.focus} />
      {data.method !== 'none' && <DevicesSection access={data} guard={guard} focus={fix.focus} />}
      <ReachSection access={data} focus={fix.focus} />
      {dialog}
      <Text size="xs" tone="subtle" className={styles.footnote}>
        <Laptop aria-hidden /> Locked out? On the computer running Conch, run{' '}
        <code>conch reset</code>, then <code>conch hello</code> for a link that makes it yours
        again.
      </Text>
    </Stack>
  );
}

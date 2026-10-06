import {
  checkPassword,
  isStaleKey,
  suggestPassword,
  type AccessMethod,
  type AccessSettings,
  type CheckupFix,
  type CheckupPlace,
  type CreatedKey,
} from '@conch/protocol';
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Field,
  IconButton,
  Input,
  PasskeyList,
  PasswordInput,
  RadioGroup,
  SecretReveal,
  SecurityCheckup,
  SettingsAdvanced,
  Skeleton,
  Stack,
  StrengthMeter,
  Text,
  toast,
  type CheckItem,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Laptop,
  LockKeyhole,
  Plus,
  ShieldOff,
  Sparkles,
  Trash2,
  FingerprintPattern,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { Section } from '../settings/Section';
import { useAdvanced } from '../settings/useAdvanced';
import { AddressSection } from './AddressSection';
import { fail, reveal, useAccess, useApply, type Focus as AccessFocus, type Guard } from './access';
import {
  ADD_DEVICE_FOCUS,
  ADDRESS_FOCUS,
  DEVICES_FOCUS,
  PASSKEYS_FOCUS,
  REACH_FOCUS,
} from './focus';
import styles from './Security.module.css';
import { createPasskey, passkeyProblem } from './passkey';
import { applySignedIn } from './signedIn';
import { usePasskeyPlatform } from './usePasskeyPlatform';
import { useVerify } from './useVerify';
import { LIVE_DATA_FOCUS, LiveDataSection } from '../artifacts/LiveDataSection';
import { SafetySection } from '../safety/SafetySection';

/** A part of this tab a checkup fix can bring you to (devices and reaching Conch are Settings → Devices). */
type Place = Exclude<CheckupPlace, 'models' | 'channels' | 'other-apps' | 'devices' | 'reach'>;
type Focus = AccessFocus<Place>;

// ── Sign-in method ─────────────────────────────────────────────────────────

const methods: { value: AccessMethod; label: string; description: string; icon: ReactNode }[] = [
  {
    value: 'passkey',
    label: 'Passkeys only',
    description: 'Touch ID, Windows Hello or Face ID. Nothing to type.',
    icon: <FingerprintPattern />,
  },
  {
    value: 'password',
    label: 'Password',
    description: 'Easiest on your own devices.',
    icon: <LockKeyhole />,
  },
  {
    value: 'key',
    label: 'Access key',
    description: 'Pasted once per device. Good for scripts, too.',
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
          ? 'Anyone using this computer can open Conch. A sign-in is also what your phone needs.'
          : access.passkeys.length && access.method !== 'passkey'
            ? 'Every device signs in. Your passkeys work too.'
            : 'Every device, including this one, signs in.'
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
            Your passkeys are the way in. Add a password here to have both.
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
          ? undefined
          : 'Passkeys need Conch’s secure address (https://…) or this computer. Open Conch there to add one.'
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
      else if (fix.place === 'other-apps') openSettings('other-apps');
      // Devices, approving them and reaching Conch from a phone have a place of their own.
      else if (fix.place === 'devices') openSettings('devices', DEVICES_FOCUS);
      else if (fix.place === 'reach') openSettings('devices', REACH_FOCUS);
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
  // The checks that are already right, and the two ways out of this computer,
  // wait under Advanced — and open by themselves when ⌘K or a fix points there.
  const [advanced, setAdvanced] = useAdvanced(LIVE_DATA_FOCUS, ADDRESS_FOCUS);
  const asked = fix.focus?.place;
  useEffect(() => {
    if (asked === 'live-data' || asked === 'address') setAdvanced(true);
  }, [asked, setAdvanced]);
  // Opened to a part of the tab (⌘K's "Passkeys", a fix's "Your address").
  const settingsFocus = useUi((s) => s.settingsFocus);
  const openSettings = useUi((s) => s.openSettings);
  const loaded = Boolean(access.data);
  const { focusOn } = fix;
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
  useEffect(() => {
    if (settingsFocus !== ADDRESS_FOCUS || !loaded) return;
    useUi.setState({ settingsFocus: undefined });
    focusOn('address');
  }, [settingsFocus, loaded, focusOn]);

  // "Add your phone" with no sign-in yet (Settings → Devices sends it here): a
  // phone signs in with a password, so that comes first, and the code for the
  // phone follows by itself, back in Devices, once it's set.
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
    openSettings('devices', ADD_DEVICE_FOCUS);
  }, [method, openSettings]);

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
      <Section title="Security" description="Keep Conch — and this computer — safe.">
        <SecurityCheckup items={items} />
      </Section>
      <PasskeysSection access={data} guard={guard} focus={fix.focus} />
      <SignInSection access={data} guard={guard} focus={fix.focus} />
      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <SafetySection />
        <LiveDataSection focus={fix.focus} />
        <AddressSection guard={guard} focus={fix.focus} />
      </SettingsAdvanced>
      {dialog}
      <Text size="xs" tone="subtle" className={styles.footnote}>
        <Laptop aria-hidden /> Locked out? On the computer running Conch, run{' '}
        <code>conch reset</code>, then <code>conch hello</code> for a link that makes it yours
        again.
      </Text>
    </Stack>
  );
}

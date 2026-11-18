import {
  KEY_LIFETIMES,
  checkPassword,
  isStaleKey,
  suggestPassword,
  type AccessMethod,
  type AccessSettings,
  type CreatedKey,
} from '@conch/protocol';
import {
  AlertDialog,
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  PasskeyList,
  PasswordInput,
  RadioGroup,
  SecretReveal,
  Select,
  Stack,
  StrengthMeter,
  Text,
  toast,
  META_SEP,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  FingerprintPattern,
  KeyRound,
  LockKeyhole,
  Plus,
  ShieldOff,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { Section } from '../settings/Section';
import { fail, reveal, useApply, type Focus as AccessFocus, type Guard } from './access';
import { createPasskey, passkeyProblem } from './passkey';
import styles from './Security.module.css';
import { applySignedIn } from './signedIn';
import { usePasskeyPlatform } from './usePasskeyPlatform';

/*
 * Settings → Access: the ways in — how you sign in (a password, access keys,
 * or none), your passkeys, and access keys for scripts and agents, which sit
 * beside every way of signing in (ADR 0153). A checkup fix on Security brings
 * you to them.
 */

/** A part of these sections a checkup fix can bring you to. */
export type SignInPlace = 'sign-in' | 'keys' | 'passkeys';
type Focus = AccessFocus<SignInPlace>;

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
    description: 'Pasted once per device, in place of a password.',
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
            Other devices will be signed out. Your access keys keep working for scripts.
          </Text>
        )}
      </Stack>
    </form>
  );
}

/** What a script's key may do, said where it's made. */
const KEY_CAN_DO =
  'It can do what you can do in Conch, through its API: chats, files, commands and settings. It can’t change how you sign in, sign a device in, or make more keys.';

/** A key, shown once, until you say you've saved it. */
function ShownOnce({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  return (
    <Stack gap={3}>
      <SecretReveal secret={created.key} title={`Access key “${created.info.name}”`} />
      <Text size="sm" tone="muted">
        {created.info.signIn ? 'Paste it on the sign-in screen, or send' : 'Send'} it as{' '}
        <code>Authorization: Bearer …</code>. {KEY_CAN_DO}
      </Text>
      <Button variant="surface" onClick={onDone} className={styles.end}>
        I’ve saved it
      </Button>
    </Stack>
  );
}

/**
 * Make a key and, with `signIn`, make access keys how people sign in. Without
 * it, a key for scripts: nothing else changes (ADR 0153).
 */
function NewKey({
  access,
  guard,
  signIn,
}: {
  access: AccessSettings;
  guard: Guard;
  signIn: boolean;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(signIn && !access.keys.length ? 'My devices' : '');
  const [lasts, setLasts] = useState('forever');
  const [created, setCreated] = useState<CreatedKey>();
  const [busy, setBusy] = useState(false);
  const switching = signIn && access.method !== 'key';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const expiresIn = KEY_LIFETIMES.find((l) => String(l.ms) === lasts)?.ms;
      await guard(async () => {
        const key = await api.createKey(name.trim(), {
          ...(switching && { signIn: true }),
          ...(!signIn && expiresIn && { expiresIn }),
        });
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

  if (created) return <ShownOnce created={created} onDone={() => setCreated(undefined)} />;

  return (
    <form
      className={styles.inline}
      onSubmit={(e) => void submit(e)}
      aria-label={signIn ? 'New access key to sign in with' : 'New access key'}
    >
      <Field className={styles.grow}>
        <Field.Label>Name</Field.Label>
        <Input
          name="key-name"
          value={name}
          maxLength={40}
          placeholder={signIn ? 'e.g. iPhone, work laptop' : 'e.g. Backup script, Hermes'}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      {!signIn && (
        <Field>
          <Field.Label>Works</Field.Label>
          <Select value={lasts} onValueChange={setLasts} aria-label="How long it works">
            <Select.Item value="forever">Until you revoke it</Select.Item>
            {KEY_LIFETIMES.map((l) => (
              <Select.Item key={l.ms} value={String(l.ms)}>
                For {l.label}
              </Select.Item>
            ))}
          </Select>
        </Field>
      )}
      <Button type="submit" leadingIcon={<Plus />} loading={busy} disabled={!name.trim()}>
        {switching ? 'Create key & turn on' : 'Create key'}
      </Button>
      {switching && (
        <Text size="sm" tone="muted" className={styles.full}>
          {access.method === 'password'
            ? 'Your password will stop working and other devices will be signed out.'
            : 'Other devices will be signed out, and sign in with this key.'}
          {access.passkeys.length > 0 && ' Your passkeys keep working.'}
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
              {[
                `Created ${relativeTime(key.createdAt)}`,
                key.lastUsedAt ? `last used ${relativeTime(key.lastUsedAt)}` : 'never used',
                key.expiresAt !== undefined && `stops ${relativeTime(key.expiresAt)}`,
                key.signIn ? 'signs you in' : 'for scripts',
              ]
                .filter(Boolean)
                .join(META_SEP)}
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

export function SignInSection({
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
  const wanted: AccessMethod | undefined = focus?.place === 'sign-in' ? 'password' : undefined;
  if (wanted && choice !== wanted) {
    setChoice(wanted);
    setChanging(false);
  }
  const current = choice === access.method;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus?.place !== 'sign-in') return;
    focus.done();
    const section = ref.current;
    reveal(section, section?.querySelector<HTMLElement>('input[name="new-password"]'));
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
            {current && (
              <Text size="sm" tone="muted">
                Each device signs in with an access key: make one for each, here. Your keys are
                listed under Access keys.
              </Text>
            )}
            {/* Stays put as the method changes: the new key is on screen, shown only once. */}
            <NewKey access={access} guard={guard} signIn />
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

// ── Access keys (ADR 0153) ──────────────────────────────────────────────────

/**
 * Keys for scripts and agents: an extra way in beside however you sign in.
 * Making one signs nobody out and changes nothing else; revoking one ends
 * only what used it.
 */
export function KeysSection({
  access,
  guard,
  focus,
}: {
  access: AccessSettings;
  guard: Guard;
  focus?: Focus;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus?.place !== 'keys') return;
    focus.done();
    const section = ref.current;
    reveal(
      section,
      section?.querySelector<HTMLElement>('[data-stale] button') ??
        section?.querySelector<HTMLElement>('input[name="key-name"]'),
    );
  }, [focus]);

  return (
    <Section
      ref={ref}
      title="Access keys"
      description={
        access.method === 'none'
          ? 'For scripts and agents on this computer that use Conch’s API. Making one changes nothing else.'
          : 'For scripts and agents that use Conch’s API. Making one changes nothing else: you sign in as before, and nobody is signed out.'
      }
    >
      <Stack gap={4}>
        {access.keys.length > 0 && <KeyList access={access} />}
        <NewKey access={access} guard={guard} signIn={false} />
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
    .join(META_SEP);
}

export function PasskeysSection({
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

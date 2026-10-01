import type { VaultLockState } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  Field,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useAutoFocus } from '../../lib/useAutoFocus';
import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import { vaultKeys } from './queries';

/** Passwords is locked: one field, one button. */
export function LockScreen() {
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ref = useAutoFocus<HTMLInputElement>();
  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await vaultApi.unlock(password);
      setPassword('');
      void client.invalidateQueries({ queryKey: vaultKeys.all });
    } catch (e) {
      setError(errorText(e, 'That didn’t unlock it.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void unlock(e)} aria-label="Unlock Passwords">
      <EmptyState
        icon={<LockKeyhole />}
        title="Passwords is locked"
        description="Your password opens it on this computer. Conch’s own keys keep working while it’s locked."
        actions={
          <Stack gap={2} align="center" style={{ inlineSize: 'min(20rem, 100%)' }}>
            <PasswordInput
              ref={ref}
              aria-label="Password for Passwords"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={Boolean(error)}
            />
            {error && (
              <Text size="sm" tone="danger" role="alert">
                {error}
              </Text>
            )}
            <Button type="submit" block loading={busy} disabled={!password}>
              Unlock
            </Button>
          </Stack>
        }
      />
    </form>
  );
}

const AUTO_LOCK = [
  { value: '5', label: 'After 5 minutes unused' },
  { value: '15', label: 'After 15 minutes unused' },
  { value: '30', label: 'After 30 minutes unused' },
  { value: '60', label: 'After an hour unused' },
  { value: '240', label: 'After 4 hours unused' },
  { value: '0', label: 'Only when Conch stops' },
];

/**
 * "Ask for a password to open Passwords": the password and the computer's own
 * key together open it, so a copy of your files is no use elsewhere, and it
 * closes again by itself.
 */
export function LockDialog({
  open,
  onOpenChange,
  lock,
  guard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lock: VaultLockState;
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
}) {
  const client = useQueryClient();
  const [enabling, setEnabling] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refresh = () => void client.invalidateQueries({ queryKey: vaultKeys.all });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== again) return setError('The two don’t match.');
    setBusy(true);
    try {
      const done = await guard(() => vaultApi.setLock({ enabled: true, password }));
      if (!done) return;
      toast.success('Passwords now asks for its password');
      setEnabling(false);
      setPassword('');
      setAgain('');
      refresh();
    } catch (e) {
      setError(errorText(e, 'Couldn’t turn the lock on.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md">
        <Dialog.Header>
          <Dialog.Title>Lock Passwords</Dialog.Title>
          <Dialog.Description>
            Your passwords are always encrypted. With the lock on, they also need a password to
            open, and close again by themselves.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            <Switch
              label="Ask for a password to open Passwords"
              description="Your sign-ins, cards and notes. Conch’s own keys keep working either way, so chats and routines don’t stop."
              checked={lock.enabled || enabling}
              onCheckedChange={(on) => {
                if (on) return setEnabling(true);
                if (!lock.enabled) return setEnabling(false);
                void guard(() => vaultApi.setLock({ enabled: false }))
                  .then((r) => r && refresh())
                  .catch((e: unknown) => setError(errorText(e, 'Couldn’t turn the lock off.')));
              }}
            />
            {enabling && !lock.enabled && (
              <form onSubmit={(e) => void save(e)}>
                <Stack gap={3}>
                  <Field>
                    <Field.Label size="sm">New password</Field.Label>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field>
                    <Field.Label size="sm">Once more</Field.Label>
                    <PasswordInput
                      value={again}
                      onChange={(e) => setAgain(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Callout tone="warning">
                    Nobody can reset it, Conch included. If you forget it, your passwords only come
                    back from a backup made with a passphrase.
                  </Callout>
                  {error && (
                    <Text tone="danger" size="sm" role="alert">
                      {error}
                    </Text>
                  )}
                  <Button type="submit" loading={busy}>
                    Turn on the lock
                  </Button>
                </Stack>
              </form>
            )}
            {lock.enabled && (
              <Field>
                <Field.Label size="sm" id="auto-lock">
                  Lock by itself
                </Field.Label>
                <Select
                  aria-labelledby="auto-lock"
                  value={String(lock.autoLockMinutes)}
                  onValueChange={(v) =>
                    void vaultApi.setLock({ autoLockMinutes: Number(v) }).then(refresh)
                  }
                >
                  {AUTO_LOCK.map((o) => (
                    <Select.Item key={o.value} value={o.value}>
                      {o.label}
                    </Select.Item>
                  ))}
                </Select>
              </Field>
            )}
            {error && !enabling && (
              <Text tone="danger" size="sm" role="alert">
                {error}
              </Text>
            )}
          </Stack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

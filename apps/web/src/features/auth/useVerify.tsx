import type { AccessMethod } from '@conch/protocol';
import { Button, Callout, Dialog, Field, PasswordInput, Stack } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';

type Task = () => Promise<unknown>;

/**
 * "Sudo mode": sensitive changes need your password or key from the last
 * ten minutes. `guard(task)` runs the task; if the gateway asks you to
 * confirm, a dialog does, and the task runs again once you have.
 */
export function useVerify(method: AccessMethod) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const pending = useRef<{ task: Task; resolve: (ok: boolean) => void }>(undefined);

  const guard = async (task: Task): Promise<boolean> => {
    try {
      await task();
      return true;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'verify-required')) throw error;
      return new Promise<boolean>((resolve) => {
        pending.current = { task, resolve };
        setOpen(true);
      });
    }
  };

  const finish = async (verified: boolean) => {
    setOpen(false);
    const current = pending.current;
    pending.current = undefined;
    if (!current) return;
    if (!verified) return current.resolve(false);
    await current.task();
    current.resolve(true);
  };

  const dialog = (
    <VerifyDialog
      open={open}
      method={method}
      onVerified={async () => {
        void client.invalidateQueries({ queryKey: keys.access });
        await finish(true);
      }}
      onCancel={() => void finish(false)}
    />
  );
  return { guard, dialog };
}

function VerifyDialog({
  open,
  method,
  onVerified,
  onCancel,
}: {
  open: boolean;
  method: AccessMethod;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ref = useAutoFocus<HTMLInputElement>();
  const what = method === 'key' ? 'access key' : 'password';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.verify(secret);
      setSecret('');
      await onVerified();
    } catch (err) {
      const apiError = err as ApiError;
      setError(
        apiError.code === 'rate-limited'
          ? `Too many tries. Wait ${apiError.retryAfter ?? 60} seconds.`
          : apiError.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSecret('');
          setError(undefined);
          onCancel();
        }
      }}
    >
      <Dialog.Content size="sm">
        <form onSubmit={(e) => void submit(e)}>
          <Dialog.Header>
            <Dialog.Title>Confirm it’s you</Dialog.Title>
            <Dialog.Description>
              Enter your {what} to make this change. You won’t be asked again for ten minutes.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap={3}>
              <Field invalid={Boolean(error)}>
                <Field.Label>{method === 'key' ? 'Access key' : 'Password'}</Field.Label>
                <PasswordInput
                  ref={ref}
                  autoComplete={method === 'key' ? 'off' : 'current-password'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                />
              </Field>
              {error && (
                <Callout tone="danger" live="assertive">
                  {error}
                </Callout>
              )}
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button type="submit" loading={busy} disabled={!secret}>
              Confirm
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

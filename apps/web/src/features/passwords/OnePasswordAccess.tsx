import { SERVICE_ACCOUNT_TOKEN, type VaultSource } from '@conch/protocol';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Field,
  PasswordInput,
  RadioGroup,
  Stack,
  Text,
  toast,
  META_SEP,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { errorText } from '../integrations/queries';
import styles from '../integrations/Integrations.module.css';
import { GetIt } from '../setup/GetIt';
import { vaultApi } from './api';
import { vaultKeys } from './queries';

/** 1Password's own guide to making a service account. */
export const SERVICE_ACCOUNT_DOCS =
  'https://developer.1password.com/docs/service-accounts/get-started/';

type Mode = 'app' | 'service-account';

/** “Service account · 2 vaults”, or “1Password app”: how Conch reaches 1Password, in a few words. */
export function onePasswordVia(source: VaultSource | undefined): string | undefined {
  if (source?.id !== '1password' || !source.access || source.state === 'off') return undefined;
  if (source.access.mode === 'app') return 'With the 1Password app';
  const shown = source.access.shown?.length ?? source.access.vaults?.length;
  return shown === undefined
    ? 'Service account'
    : `Service account${META_SEP}${shown} ${shown === 1 ? 'vault' : 'vaults'}`;
}

/**
 * How Conch reaches 1Password: the app on this computer, or a service
 * account's token for a computer without it (a server). The token is typed
 * once, tried, then kept sealed; it never comes back to this page.
 */
export function OnePasswordAccess({
  source,
  open,
  onOpenChange,
  guard,
}: {
  source: VaultSource | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
}) {
  const client = useQueryClient();
  const current: Mode = source?.access?.mode ?? 'app';
  const on = source !== undefined && source.state !== 'off';
  const [mode, setMode] = useState<Mode>(current);
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [chosen, setChosen] = useState<string[]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  // Opened again: start from how it is now.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode(current);
      setReplacing(false);
      setChosen(undefined);
      setError(undefined);
    }
    setToken('');
  }

  const connected = on && current === 'service-account';
  const vaults = source?.access?.vaults ?? [];
  const shown = chosen ?? source?.access?.shown ?? vaults.map((v) => v.id);
  const asksToken = mode === 'service-account' && (!connected || replacing);
  const tokenOk = SERVICE_ACCOUNT_TOKEN.test(token.replace(/\s+/g, ''));

  const run = async (id: string, task: () => Promise<unknown>) => {
    setBusy(id);
    setError(undefined);
    try {
      await task();
      await client.invalidateQueries({ queryKey: vaultKeys.all });
    } catch (e) {
      setError(errorText(e, 'That didn’t work.'));
    } finally {
      setBusy(undefined);
    }
  };

  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (!tokenOk) return;
    void run('connect', async () => {
      const done = await guard(() => vaultApi.connectOnePassword(token));
      // Gone from this page as soon as it's sent: only the sealed copy is kept.
      setToken('');
      if (!done) return;
      setReplacing(false);
      const n = done.vaults.length;
      toast.success(`Connected${META_SEP}${n} ${n === 1 ? 'vault' : 'vaults'}`);
    });
  };

  const useApp = () =>
    void run('app', async () => {
      if (current === 'service-account') await vaultApi.forgetOnePassword();
      if (!on) await vaultApi.setSource('1password', { enabled: true });
      toast.success('1Password now goes through the app on this computer');
      onOpenChange(false);
    });

  const disconnect = () =>
    void run('off', async () => {
      if (current === 'service-account') await vaultApi.forgetOnePassword(true);
      else await vaultApi.setSource('1password', { enabled: false });
      toast('1Password is disconnected', {
        description:
          current === 'service-account' ? 'Conch forgot the token.' : 'Its items left Passwords.',
      });
      onOpenChange(false);
    });

  const saveVaults = () =>
    void run('vaults', async () => {
      await vaultApi.setOnePasswordVaults(shown);
      setChosen(undefined);
      toast.success(`Showing ${shown.length} ${shown.length === 1 ? 'vault' : 'vaults'}`);
    });

  const changedVaults =
    chosen !== undefined &&
    (chosen.length !== (source?.access?.shown ?? vaults.map((v) => v.id)).length ||
      chosen.some((id) => !(source?.access?.shown ?? vaults.map((v) => v.id)).includes(id)));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md">
        <form onSubmit={connect}>
          <Dialog.Header>
            <Dialog.Title>Connect 1Password</Dialog.Title>
            <Dialog.Description>
              Your 1Password items show in Passwords and stay in 1Password.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap={4}>
              <RadioGroup
                variant="card"
                aria-label="How Conch reaches 1Password"
                value={mode}
                onValueChange={(v) => {
                  setMode(v as Mode);
                  setError(undefined);
                }}
              >
                <RadioGroup.Item
                  value="app"
                  label={
                    <span>
                      Use the 1Password app on this computer{' '}
                      {on && current === 'app' && (
                        <Badge size="sm" tone="success" variant="soft">
                          In use
                        </Badge>
                      )}
                    </span>
                  }
                  description="Unlock with Touch ID or Windows Hello. In the app, turn on Settings › Developer › Integrate with 1Password CLI."
                />
                <RadioGroup.Item
                  value="service-account"
                  label={
                    <span>
                      Use a service account token{' '}
                      {connected && (
                        <Badge size="sm" tone="success" variant="soft">
                          In use
                        </Badge>
                      )}
                    </span>
                  }
                  description="For a computer without the 1Password app, like a server. Conch reads only the vaults you give it."
                />
              </RadioGroup>

              {source?.state === 'missing' && (
                <GetIt needId="op" lead="Both ways need the 1Password command line tool." />
              )}

              {mode === 'service-account' && connected && !replacing && (
                <Stack gap={2}>
                  <Text size="sm" weight="medium">
                    Vaults shown in Conch
                  </Text>
                  {vaults.length === 0 ? (
                    <Text size="sm" tone="muted">
                      {source.message ?? 'Conch hasn’t read its vaults yet.'}
                    </Text>
                  ) : (
                    vaults.map((v) => (
                      <Checkbox
                        key={v.id}
                        label={v.name}
                        checked={shown.includes(v.id)}
                        onCheckedChange={(checked) =>
                          setChosen(
                            checked === true
                              ? [...new Set([...shown, v.id])]
                              : shown.filter((id) => id !== v.id),
                          )
                        }
                      />
                    ))
                  )}
                  <Stack direction="row" gap={1} wrap>
                    {changedVaults && (
                      <Button
                        size="sm"
                        variant="surface"
                        loading={busy === 'vaults'}
                        disabled={shown.length === 0}
                        onClick={saveVaults}
                      >
                        Save vaults
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
                      Replace the token
                    </Button>
                  </Stack>
                  {source.state !== 'ready' && source.message && (
                    <Callout tone="warning">{source.message}</Callout>
                  )}
                </Stack>
              )}

              {asksToken && (
                <Stack gap={3}>
                  <ol className={styles.steps}>
                    {[
                      'On 1Password.com, open Developer › Service accounts.',
                      'Create a service account. Choose the vaults Conch may see, with read access.',
                      'Copy the token it shows (it starts with ops_) and paste it here.',
                    ].map((step, i) => (
                      <li key={i}>
                        <span className={styles.stepNumber} aria-hidden>
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    trailingIcon={<ArrowUpRight />}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <a href={SERVICE_ACCOUNT_DOCS} target="_blank" rel="noopener noreferrer">
                      1Password’s guide
                    </a>
                  </Button>
                  <Field>
                    <Field.Label size="sm">Service account token</Field.Label>
                    <PasswordInput
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="ops_…"
                    />
                    <Field.Description>
                      Kept sealed on this computer. Conch never shows it again.
                    </Field.Description>
                  </Field>
                </Stack>
              )}

              {error && (
                <Callout tone="warning" role="alert">
                  {error}
                </Callout>
              )}
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            {on && (
              <Button variant="ghost" loading={busy === 'off'} onClick={disconnect}>
                Disconnect
              </Button>
            )}
            {mode === 'app' && (!on || current !== 'app') && (
              <Button loading={busy === 'app'} onClick={useApp}>
                {current === 'service-account' && on ? 'Use the app instead' : 'Connect'}
              </Button>
            )}
            {asksToken && (
              <Button type="submit" loading={busy === 'connect'} disabled={!tokenOk}>
                {connected ? 'Replace' : 'Connect'}
              </Button>
            )}
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

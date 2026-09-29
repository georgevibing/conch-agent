import type { Provider, ProvidersList, SecretSource } from '@conch/protocol';
import {
  Button,
  Callout,
  CopyButton,
  Dialog,
  Field,
  Input,
  IntegrationHandshake,
  ProviderCaution,
  SecretField,
  Spinner,
  Stack,
  Text,
  toast,
  type HandshakePhase,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api } from '../../api/client';
import { useLiveStore } from '../../live/store';
import { providersApi } from './api';
import styles from './Providers.module.css';
import {
  errorText,
  useCheckProvider,
  useSetProviderKey,
  useUseProvider,
  useWatchProvider,
} from './queries';
import { useProviderSignIn } from './useProviderSignIn';

function phaseOf(provider: Provider, busy: boolean): HandshakePhase {
  if (provider.status.state === 'ready') return 'connected';
  if (provider.status.state === 'error') return 'failed';
  if (busy || provider.status.state === 'checking') return 'waiting';
  return 'idle';
}

/** Install instructions, with Conch watching for the program to appear. */
function Install({ provider }: { provider: Provider }) {
  return (
    <Stack gap={4}>
      <Text tone="muted">
        {provider.name} isn’t on this computer yet. Run one of these in Terminal — Conch notices the
        moment it’s ready.
      </Text>
      <ul className={styles.commands}>
        {provider.install.map((hint) => (
          <li key={hint.command} className={styles.command}>
            <span className={styles.commandLabel}>{hint.label}</span>
            <code className={styles.commandText}>{hint.command}</code>
            <CopyButton value={hint.command} label={`Copy ${hint.label} command`} />
          </li>
        ))}
      </ul>
      <div className={styles.waiting}>
        <Spinner size="xs" label={null} />
        <Text as="span" size="sm" tone="muted">
          Waiting for {provider.name}…
        </Text>
        <span className={styles.spacer} />
        {provider.status.docsUrl && (
          <Button asChild variant="ghost" size="sm">
            <a href={provider.status.docsUrl} target="_blank" rel="noreferrer">
              Setup guide <ExternalLink aria-hidden className={styles.linkIcon} />
            </a>
          </Button>
        )}
      </div>
    </Stack>
  );
}

/** A program that signs itself in: Conch starts it and watches the phases. */
function SignInProgram({ provider }: { provider: Provider }) {
  const login = useLiveStore((s) => s.login);
  const setLogin = useLiveStore((s) => s.setLogin);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState('');
  const active = login && !['done', 'failed', 'cancelled'].includes(login.phase);

  const start = async () => {
    setStarting(true);
    setLogin({ loginId: 'local', phase: 'starting' });
    try {
      await providersApi.login(provider.id, 'subscription');
    } catch (error) {
      setLogin({ loginId: 'local', phase: 'failed', message: errorText(error, 'Sign-in failed.') });
    } finally {
      setStarting(false);
    }
  };

  if (active) {
    return (
      <Stack gap={4} aria-live="polite">
        {login.phase === 'starting' && (
          <div className={styles.waiting}>
            <Spinner size="xs" label={null} />
            <Text as="span" size="sm" tone="muted">
              Starting sign-in…
            </Text>
          </div>
        )}
        {login.phase === 'waiting-for-browser' && (
          <Stack gap={3}>
            <Text weight="medium">A sign-in page opened in your browser.</Text>
            <Text tone="muted" size="sm">
              Finish there and come back — this updates on its own.
            </Text>
            {login.url && (
              <div>
                <Button asChild variant="surface" size="sm">
                  <a href={login.url} target="_blank" rel="noreferrer">
                    Open the sign-in page <ExternalLink aria-hidden className={styles.linkIcon} />
                  </a>
                </Button>
              </div>
            )}
          </Stack>
        )}
        {login.phase === 'needs-code' && (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!code.trim()) return;
              void api.submitLoginCode(code.trim());
              setCode('');
            }}
          >
            <Field>
              <Field.Label>Paste the code from the sign-in page</Field.Label>
              <div className={styles.row}>
                <Input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
                <Button type="submit">Continue</Button>
              </div>
            </Field>
          </form>
        )}
        {login.phase === 'verifying' && (
          <div className={styles.waiting}>
            <Spinner size="xs" label={null} />
            <Text as="span" size="sm" tone="muted">
              Checking your sign-in…
            </Text>
          </div>
        )}
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void api.cancelLogin();
              setLogin(undefined);
            }}
          >
            Cancel
          </Button>
        </div>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      {login?.phase === 'failed' && (
        <Callout tone="warning" title="Sign-in didn’t finish">
          {login.message ?? 'Please try again.'}
        </Callout>
      )}
      <Text tone="muted">
        {provider.name} is installed. Sign in once and you’re ready — Conch uses the sign-in that’s
        already on this computer.
      </Text>
      <div>
        <Button size="lg" loading={starting} onClick={() => void start()}>
          Sign in to {provider.name}
        </Button>
      </div>
    </Stack>
  );
}

/** A provider you hold a key for. One click if it can make the key itself. */
function KeyForm({
  provider,
  onePassword,
}: {
  provider: Provider;
  onePassword: ProvidersList['onePassword'];
}) {
  const form = provider.keyForm;
  const setKey = useSetProviderKey();
  const signIn = useProviderSignIn();
  const [value, setValue] = useState('');
  const [source, setSource] = useState<SecretSource>(provider.key?.source ?? 'conch');
  const [error, setError] = useState<string>();

  if (!form) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await setKey.mutateAsync({ id: provider.id, value: value.trim() });
      setValue('');
      toast.success(`${provider.name} is connected.`);
    } catch (e) {
      setError(errorText(e, 'That key didn’t work.'));
    }
  };

  const typed = value.trim();
  const looksWrong =
    source === 'conch' && form.pattern && typed.length > 3 && !new RegExp(form.pattern).test(typed);

  return (
    <Stack gap={5}>
      {form.canSignIn && (
        <Stack gap={2}>
          <Button size="lg" onClick={() => void signIn(provider)}>
            Sign in to {provider.name}
          </Button>
          <Text size="sm" tone="subtle">
            {provider.name} makes a key for Conch, so there’s nothing to copy.
          </Text>
        </Stack>
      )}
      <form onSubmit={submit}>
        <Stack gap={4}>
          <SecretField
            label={form.label}
            value={value}
            onValueChange={(next) => {
              setValue(next);
              setError(undefined);
            }}
            source={source}
            onSourceChange={(next) => {
              setSource(next);
              setValue('');
              setError(undefined);
            }}
            placeholder={form.placeholder}
            help={form.help}
            url={form.url}
            error={error ?? (looksWrong ? form.patternHint : undefined)}
            onePassword={onePassword}
            saved={provider.key}
          />
          <div>
            <Button
              type="submit"
              variant="surface"
              loading={setKey.isPending}
              disabled={typed.length < 8 || Boolean(looksWrong)}
            >
              {provider.key ? 'Replace key' : 'Connect'}
            </Button>
          </div>
        </Stack>
      </form>
    </Stack>
  );
}

/** What's true once it works, and how to make it the one in use. */
function Connected({ provider }: { provider: Provider }) {
  const use = useUseProvider();
  const check = useCheckProvider();
  const { status } = provider;
  return (
    <Stack gap={5}>
      <dl className={styles.facts}>
        {status.auth && (
          <>
            <dt>Account</dt>
            <dd>{status.auth.description}</dd>
          </>
        )}
        {provider.key && (
          <>
            <dt>Key</dt>
            <dd>
              {provider.key.source === '1password'
                ? `1Password · ${provider.key.hint}`
                : `On this computer · ${provider.key.hint}`}
            </dd>
          </>
        )}
        {status.version && (
          <>
            <dt>Version</dt>
            <dd>{status.version}</dd>
          </>
        )}
        {status.executablePath && (
          <>
            <dt>Location</dt>
            <dd className={styles.mono}>{status.executablePath}</dd>
          </>
        )}
      </dl>
      <Stack direction="row" gap={2} wrap>
        {!provider.active && (
          <Button
            loading={use.isPending}
            onClick={() => use.mutate(provider.id)}
          >{`Use ${provider.name}`}</Button>
        )}
        <Button
          variant="surface"
          loading={check.isPending}
          onClick={() => check.mutate(provider.id)}
        >
          Check again
        </Button>
      </Stack>
    </Stack>
  );
}

export interface ConnectProviderDialogProps {
  provider?: Provider;
  onePassword: ProvidersList['onePassword'];
  onOpenChange: (open: boolean) => void;
}

/**
 * One dialog for every way a provider connects: install it, sign in to it, or
 * give it a key. It watches the provider while it's open, so a program
 * installed in a terminal — or a sign-in finished in another window — moves the
 * dialog on by itself.
 */
export function ConnectProviderDialog({
  provider,
  onePassword,
  onOpenChange,
}: ConnectProviderDialogProps) {
  const client = useQueryClient();
  const setLogin = useLiveStore((s) => s.setLogin);

  // Forget a previous attempt's outcome when a different provider opens.
  useEffect(() => {
    if (provider) setLogin(undefined);
  }, [provider?.id, provider, setLogin]);

  // Coming back from another window (a sign-in, a terminal): look again.
  useEffect(() => {
    if (!provider) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void client.invalidateQueries({ queryKey: ['providers'] });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [provider, client]);

  const state = provider?.status.state;
  // While this dialog is open and the provider isn't working yet, keep looking.
  useWatchProvider(provider?.id, Boolean(provider) && state !== 'ready');

  // It just started working: let the handshake land, then get out of the way.
  // A dialog opened on a provider that was already connected stays put — you
  // opened it to look at the details.
  const wasReady = useRef(state === 'ready');
  useEffect(() => {
    if (!provider) {
      wasReady.current = false;
      return;
    }
    if (state !== 'ready') {
      wasReady.current = false;
      return;
    }
    if (wasReady.current) return;
    const timer = setTimeout(() => onOpenChange(false), 1600);
    return () => clearTimeout(timer);
  }, [provider, state, onOpenChange]);

  return (
    <Dialog.Root open={Boolean(provider)} onOpenChange={onOpenChange}>
      <Dialog.Content size="md">
        {provider && (
          <>
            <Dialog.Header>
              <IntegrationHandshake
                name={provider.name}
                brand={provider.status.engine}
                color={provider.color}
                phase={phaseOf(provider, false)}
              />
              <Dialog.Title>
                {state === 'ready' ? `${provider.name} is connected` : `Connect ${provider.name}`}
              </Dialog.Title>
              <Dialog.Description>{provider.description}</Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap={5}>
                {state === 'error' && provider.status.message && (
                  <Callout tone="danger" title={`${provider.name} didn’t answer`}>
                    {provider.status.message}
                  </Callout>
                )}
                {state === 'ready' ? (
                  <Connected provider={provider} />
                ) : state === 'not-installed' ? (
                  <Install provider={provider} />
                ) : provider.connect === 'key' ? (
                  <KeyForm provider={provider} onePassword={onePassword} />
                ) : (
                  <SignInProgram provider={provider} />
                )}
                {provider.limits.map((limit) => (
                  <ProviderCaution key={limit}>{limit}</ProviderCaution>
                ))}
              </Stack>
            </Dialog.Body>
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

import type { Provider, ProvidersList, SecretSource } from '@conch/protocol';
import {
  Button,
  Callout,
  Collapsible,
  CopyButton,
  Dialog,
  Field,
  Heading,
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
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { api } from '../../api/client';
import { useLiveStore } from '../../live/store';
import { LocalSetup } from '../local/LocalSetup';
import { GetIt } from '../setup/GetIt';
import { useNeed } from '../setup/useNeed';
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

/** The commands to install it by hand, to copy. */
function Commands({ provider }: { provider: Provider }) {
  return (
    <ul className={styles.commands}>
      {provider.install.map((hint) => (
        <li key={hint.command} className={styles.command}>
          <span className={styles.commandLabel}>{hint.label}</span>
          <code className={styles.commandText}>{hint.command}</code>
          <CopyButton value={hint.command} label={`Copy ${hint.label} command`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Not on this computer yet: Conch offers to install it (one button, with
 * progress), and the commands stay folded underneath for anyone who'd rather.
 * Either way Conch notices the moment it's there and moves on to signing in.
 */
function Install({ provider }: { provider: Provider }) {
  const fix = provider.status.fix;
  return (
    <Stack gap={4}>
      {fix?.kind === 'install' ? (
        <GetIt
          needId={fix.need}
          name={provider.name}
          lead={`${provider.name} isn’t on this computer yet. Conch can install it for you — it takes a minute or two.`}
        >
          {provider.install.length > 0 && (
            <Collapsible>
              <Collapsible.Trigger className={styles.byHand}>
                Or install it yourself
              </Collapsible.Trigger>
              <Collapsible.Content>
                <Commands provider={provider} />
              </Collapsible.Content>
            </Collapsible>
          )}
        </GetIt>
      ) : (
        <>
          <Text tone="muted">
            {provider.name} isn’t on this computer yet. Run one of these in Terminal — Conch notices
            the moment it’s ready.
          </Text>
          <Commands provider={provider} />
        </>
      )}
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

/** 1Password is locked: open it, so you can unlock it. Conch reads the key again when you're back. */
function OpenOnePassword() {
  const { need, act } = useNeed('1password-app');
  if (!need?.openable) return null;
  return (
    <div>
      <Button variant="surface" size="sm" onClick={() => void act('open')}>
        Open 1Password
      </Button>
    </div>
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
  // Keeping it in 1Password needs the `op` command: Conch offers to get it
  // instead of showing a command to copy.
  const opFix =
    !onePassword.available && (source === '1password' || provider.key?.source === '1password')
      ? onePassword.fix
      : undefined;
  const locked = /locked|unlock/i.test(error ?? provider.key?.problem ?? '');

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
            onePassword={opFix ? { ...onePassword, installCommand: undefined } : onePassword}
            saved={provider.key}
          />
          {opFix && (
            <GetIt
              needId={opFix.need}
              kind={opFix.kind}
              name="the 1Password CLI"
              lead="Conch reads keys from 1Password with its command-line tool. Conch can install it for you."
            />
          )}
          {locked && <OpenOnePassword />}
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

/** What's true once it works, and how to make it the default for new chats. */
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
        {status.bundled ? (
          <>
            <dt>Location</dt>
            <dd>Comes with Conch — nothing to install or update.</dd>
          </>
        ) : (
          status.executablePath && (
            <>
              <dt>Location</dt>
              <dd className={styles.mono}>{status.executablePath}</dd>
            </>
          )
        )}
      </dl>
      <Stack direction="row" gap={2} wrap>
        {!provider.active && (
          <Button
            loading={use.isPending}
            onClick={() => use.mutate(provider.id)}
          >{`Make ${provider.name} the default`}</Button>
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

/** Keep an eye on a provider while it's in front of you. */
function useProviderWatch(provider: Provider | undefined) {
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

  // While the provider isn't working yet, keep looking.
  useWatchProvider(provider?.id, Boolean(provider) && provider?.status.state !== 'ready');
}

const titleOf = (provider: Provider) =>
  provider.local
    ? provider.status.state === 'ready'
      ? 'Your model on this computer'
      : 'Run a model on this computer'
    : provider.status.state === 'ready'
      ? `${provider.name} is connected`
      : `Connect ${provider.name}`;

/** Every way a provider connects — install it, sign in, or give it a key — and what's true once it does. */
function ProviderBody({
  provider,
  onePassword,
}: {
  provider: Provider;
  onePassword: ProvidersList['onePassword'];
}) {
  const state = provider.status.state;
  const fix = provider.status.fix;
  // A model on this computer is one flow of its own: Ollama, a model, done.
  if (provider.local) {
    return (
      <Stack gap={5}>
        <LocalSetup provider={provider} />
        {state === 'ready' && <Connected provider={provider} />}
        {provider.limits.map((limit) => (
          <ProviderCaution key={limit}>{limit}</ProviderCaution>
        ))}
      </Stack>
    );
  }
  return (
    <Stack gap={5}>
      {state === 'error' && provider.status.message && (
        <Callout
          tone={fix?.kind === 'update' ? 'warning' : 'danger'}
          title={
            fix?.kind === 'update'
              ? `${provider.name} needs an update`
              : `${provider.name} didn’t answer`
          }
        >
          {provider.status.message}
        </Callout>
      )}
      {state === 'error' && fix?.kind === 'update' && (
        <GetIt needId={fix.need} kind="update" name={provider.name} />
      )}
      {state === 'ready' && fix?.kind === 'update' && (
        <Callout
          tone="info"
          title={provider.status.message ?? `A newer ${provider.name} is available`}
        >
          <GetIt needId={fix.need} kind="update" name={provider.name} />
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
  );
}

/**
 * One provider, in place of the list it was opened from (Settings → Providers):
 * no dialog on top of a dialog. It watches the provider while it's open, and
 * stays until you go back — even after it connects.
 */
export function ProviderDetail({
  provider,
  onePassword,
  onBack,
}: {
  provider: Provider;
  onePassword: ProvidersList['onePassword'];
  onBack: () => void;
}) {
  useProviderWatch(provider);
  const titleId = useId();
  const backRef = useRef<HTMLButtonElement>(null);
  // Arriving here was your own click: focus lands where going back is.
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, []);
  return (
    <section aria-labelledby={titleId} className={styles.detail}>
      <Button
        ref={backRef}
        variant="ghost"
        size="sm"
        leadingIcon={<ArrowLeft />}
        onClick={onBack}
        className={styles.back}
      >
        Providers
      </Button>
      <Stack gap={3} className={styles.detailHeader}>
        <IntegrationHandshake
          name={provider.name}
          brand={provider.status.engine}
          color={provider.color}
          phase={phaseOf(provider, false)}
        />
        <Heading level={3} size="xl" id={titleId}>
          {titleOf(provider)}
        </Heading>
        <Text tone="muted">{provider.description}</Text>
      </Stack>
      <ProviderBody provider={provider} onePassword={onePassword} />
    </section>
  );
}

export interface ConnectProviderDialogProps {
  provider?: Provider;
  onePassword: ProvidersList['onePassword'];
  onOpenChange: (open: boolean) => void;
}

/**
 * The same, as a dialog, for first run — where there's no Settings to drill
 * into. Once the provider starts working, the handshake lands and the dialog
 * gets out of the way so the welcome can carry on.
 */
export function ConnectProviderDialog({
  provider,
  onePassword,
  onOpenChange,
}: ConnectProviderDialogProps) {
  useProviderWatch(provider);
  const state = provider?.status.state;

  // It just started working: let the handshake land, then close. A dialog
  // opened on a provider that was already connected stays put.
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
              <Dialog.Title>{titleOf(provider)}</Dialog.Title>
              <Dialog.Description>{provider.description}</Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              <ProviderBody provider={provider} onePassword={onePassword} />
            </Dialog.Body>
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

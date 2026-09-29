import type { EngineStatus } from '@conch/protocol';
import {
  Button,
  Callout,
  Collapsible,
  CopyButton,
  Field,
  Input,
  Spinner,
  Stack,
  Text,
  cx,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, KeyRound, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { api, ApiError } from '../../api/client';
import { setEngineStatus, useEngine } from '../../api/queries';
import { useLiveStore } from '../../live/store';
import { useAutoFocus } from '../../lib/useAutoFocus';
import styles from './EngineConnect.module.css';

type RowState = 'waiting' | 'working' | 'done' | 'failed';

function CheckRow({ state, label }: { state: RowState; label: ReactNode }) {
  return (
    <li className={styles.row} data-state={state}>
      <span className={styles.rowIcon} aria-hidden>
        {state === 'working' && <Spinner size="xs" label={null} />}
        {state === 'done' && <Check strokeWidth={2.6} />}
        {state === 'failed' && <X strokeWidth={2.6} />}
      </span>
      <span className={styles.rowLabel}>{label}</span>
    </li>
  );
}

/** Two-line live checklist: installed? signed in? Row two resolves a beat after row one. */
function Checklist({
  status,
  checking,
  signingIn,
}: {
  status?: EngineStatus;
  checking: boolean;
  signingIn: boolean;
}) {
  // Remounted (via key) whenever the state changes, so the reveal replays.
  const [stage, setStage] = useState(status ? 1 : 0);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStage(2), 550);
    return () => clearTimeout(t);
  }, [status]);

  const installed = status && status.state !== 'not-installed' && status.state !== 'error';
  const row1: RowState = !status || stage < 1 ? 'working' : installed ? 'done' : 'failed';
  const row2: RowState = !installed
    ? 'waiting'
    : stage < 2 || checking || (signingIn && status.state !== 'ready')
      ? 'working'
      : status.state === 'ready'
        ? 'done'
        : 'failed';

  return (
    <ul className={styles.checklist} aria-live="polite">
      <CheckRow
        state={row1}
        label={
          row1 === 'done'
            ? `Found Claude Code${status?.version ? ` ${status.version}` : ''}`
            : row1 === 'failed'
              ? status?.state === 'error'
                ? 'Claude Code didn’t start'
                : 'Claude Code isn’t installed yet'
              : 'Looking for Claude Code'
        }
      />
      <CheckRow
        state={row2}
        label={
          row2 === 'done'
            ? `Signed in${status?.auth ? ` · ${status.auth.description}` : ''}`
            : row2 === 'failed'
              ? 'Not signed in yet'
              : row2 === 'waiting'
                ? 'Then, sign in'
                : signingIn
                  ? 'Waiting for you to sign in'
                  : 'Checking you’re signed in'
        }
      />
    </ul>
  );
}

function InstallHelp({
  status,
  onCheck,
  checking,
}: {
  status: EngineStatus;
  onCheck: () => void;
  checking: boolean;
}) {
  return (
    <Stack gap={4} className={styles.panel}>
      <Text tone="muted">
        Install it with any one of these in Terminal — I’ll notice the moment it’s ready.
      </Text>
      <ul className={styles.commands}>
        {status.install.map((hint) => (
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
          Waiting for Claude Code…
        </Text>
        <span className={styles.spacer} />
        {status.docsUrl && (
          <Button asChild variant="ghost" size="sm">
            <a href={status.docsUrl} target="_blank" rel="noreferrer">
              Setup guide <ExternalLink aria-hidden className={styles.linkIcon} />
            </a>
          </Button>
        )}
        <Button
          variant="surface"
          size="sm"
          leadingIcon={<RotateCw />}
          loading={checking}
          onClick={onCheck}
        >
          Check again
        </Button>
      </div>
    </Stack>
  );
}

function ApiKeyForm({ onSaved }: { onSaved: (status: EngineStatus) => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await api.setApiKey(value.trim()));
      setValue('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That key didn’t work.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className={styles.keyForm}>
      <Field invalid={Boolean(error)}>
        <Field.Label>Anthropic API key</Field.Label>
        <div className={styles.keyRow}>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            leading={<KeyRound />}
          />
          <Button
            type="submit"
            variant="surface"
            loading={saving}
            disabled={value.trim().length < 10}
          >
            Use key
          </Button>
        </div>
        {error ? (
          <Field.Error>{error}</Field.Error>
        ) : (
          <Field.Description>
            Stored only on this computer (~/.conch/secrets.json). Usage is billed to your Anthropic
            Console account.
          </Field.Description>
        )}
      </Field>
    </form>
  );
}

function SignIn({ onStatus }: { onStatus: (status: EngineStatus) => void }) {
  const login = useLiveStore((s) => s.login);
  const setLogin = useLiveStore((s) => s.setLogin);
  const [code, setCode] = useState('');
  const codeRef = useAutoFocus<HTMLInputElement>();
  const [starting, setStarting] = useState(false);
  const active = login && !['done', 'failed', 'cancelled'].includes(login.phase);

  const start = async (method: 'subscription' | 'console') => {
    setStarting(true);
    setLogin({ loginId: 'local', phase: 'starting' });
    try {
      await api.startLogin(method);
    } catch (e) {
      setLogin({ loginId: 'local', phase: 'failed', message: (e as Error).message });
    } finally {
      setStarting(false);
    }
  };

  if (active) {
    return (
      <Stack gap={4} className={styles.panel} aria-live="polite">
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
              Finish signing in there and come back — this page updates on its own.
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
            onSubmit={(e) => {
              e.preventDefault();
              if (!code.trim()) return;
              void api.submitLoginCode(code.trim());
              setCode('');
            }}
          >
            <Field>
              <Field.Label>Paste the code from the sign-in page</Field.Label>
              <div className={styles.keyRow}>
                <Input
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                />
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
    <Stack gap={4} className={styles.panel}>
      {login?.phase === 'failed' && (
        <Callout tone="warning" title="Sign-in didn’t finish">
          {login.message ?? 'Please try again.'}
        </Callout>
      )}
      <Text tone="muted">
        Claude Code is installed. Sign in once with your Claude account and you’re ready.
      </Text>
      <div>
        <Button size="lg" onClick={() => void start('subscription')} loading={starting}>
          Sign in with Claude
        </Button>
      </div>
      <Collapsible>
        <Collapsible.Trigger className={styles.disclosure}>
          Other ways to sign in
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Stack gap={4} className={styles.others}>
            <div>
              <Button variant="surface" size="sm" onClick={() => void start('console')}>
                Use an Anthropic Console account
              </Button>
            </div>
            <ApiKeyForm onSaved={onStatus} />
          </Stack>
        </Collapsible.Content>
      </Collapsible>
    </Stack>
  );
}

export interface EngineConnectProps {
  /** Called once when the engine becomes ready (after a short celebratory beat). */
  onReady?: (status: EngineStatus) => void;
  className?: string;
}

/**
 * The whole "is Claude Code ready?" experience: live checklist, install help
 * that auto-detects installation, sign-in in all its forms, and errors.
 */
export function EngineConnect({ onReady, className }: EngineConnectProps) {
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  // While not ready, keep checking so installing or signing in elsewhere is noticed.
  const engine = useEngine({ poll: (s) => (s?.state === 'ready' ? false : 3000) });
  const status = engine.data;
  const readyFired = useRef(false);
  const login = useLiveStore((s) => s.login);
  const signingIn = Boolean(login && !['done', 'failed', 'cancelled'].includes(login.phase));

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  const ready = status?.state === 'ready' ? status : undefined;
  useEffect(() => {
    if (!ready || readyFired.current || !onReadyRef.current) return;
    const t = setTimeout(() => {
      readyFired.current = true;
      onReadyRef.current?.(ready);
    }, 1400);
    return () => clearTimeout(t);
  }, [ready]);

  const recheck = async () => {
    setChecking(true);
    try {
      setEngineStatus(client, await api.engine(true));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={cx(styles.root, className)}>
      <Checklist
        key={status?.state ?? 'unknown'}
        status={status}
        checking={checking}
        signingIn={signingIn}
      />
      {status?.state === 'not-installed' && (
        <InstallHelp status={status} onCheck={() => void recheck()} checking={checking} />
      )}
      {status?.state === 'signed-out' && <SignIn onStatus={(s) => setEngineStatus(client, s)} />}
      {status?.state === 'ready' && onReady && (
        <div className={styles.readyRow}>
          <Text tone="muted">You’re connected. Taking you onward…</Text>
          <Button variant="surface" size="sm" onClick={() => onReady(status)}>
            Continue
          </Button>
        </div>
      )}
      {status?.state === 'error' && (
        <Callout
          tone="danger"
          title="Claude Code didn’t respond"
          action={
            <Button size="sm" variant="surface" onClick={() => void recheck()} loading={checking}>
              Try again
            </Button>
          }
        >
          {status.message}
        </Callout>
      )}
      {engine.isError && (
        <Callout tone="danger" title="Couldn’t reach Conch">
          {(engine.error as Error).message}
        </Callout>
      )}
    </div>
  );
}

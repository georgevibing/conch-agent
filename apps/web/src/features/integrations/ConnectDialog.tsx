import type { CatalogEntry, Integration, IntegrationProvider } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  Field,
  Input,
  IntegrationHandshake,
  PasswordInput,
  Stack,
  Text,
  type HandshakePhase,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, KeyRound, MessageSquare, Monitor, RotateCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { integrationsApi } from './api';
import { accountConnected } from './describe';
import styles from './Integrations.module.css';
import {
  errorText,
  integrationKeys,
  putIntegration,
  useAssistantName,
  useExternal,
  useIntegrations,
} from './queries';
import { useSignIn } from './useSignIn';

function phaseOf(integration: Integration | undefined): HandshakePhase {
  switch (integration?.health.state) {
    case undefined:
      return 'idle';
    case 'connecting':
    case 'checking':
      return 'waiting';
    case 'ok':
    case 'warning':
      return 'connected';
    default:
      return 'failed';
  }
}

/** What the assistant can do with it, as a short checked list. */
function AccessList({ entry }: { entry: CatalogEntry }) {
  const assistant = useAssistantName();
  if (!entry.access.length) return null;
  return (
    <ul className={styles.access} aria-label={`What ${assistant} can do with ${entry.name}`}>
      {entry.access.map((line) => (
        <li key={line}>
          <Check aria-hidden />
          {line}
        </li>
      ))}
    </ul>
  );
}

/** Things to try once it's connected — each opens a new chat with the words filled in. */
export function TryIt({
  entry,
  onPick,
}: {
  entry: CatalogEntry;
  onPick: (prompt: string) => void;
}) {
  if (!entry.examples.length) return null;
  return (
    <Stack gap={2}>
      <Text size="sm" weight="medium">
        Try asking
      </Text>
      <div className={styles.examples}>
        {entry.examples.map((example) => (
          <Button
            key={example}
            variant="surface"
            size="sm"
            leadingIcon={<MessageSquare />}
            onClick={() => onPick(example)}
            className={styles.example}
          >
            {example}
          </Button>
        ))}
      </div>
    </Stack>
  );
}

/**
 * Connecting one app, start to finish, in one small dialog. Sign-in
 * services are a single button; token services show the steps next to the
 * field; things that run on this computer say exactly what will run first.
 * The handshake at the top tells you where you are at a glance.
 */
export function ConnectDialog({
  entry,
  onOpenChange,
  onAlternative,
}: {
  entry: CatalogEntry | undefined;
  onOpenChange: (open: boolean) => void;
  /** Switch to another catalog entry (e.g. Zapier, to reach a service with every model). */
  onAlternative?: (catalogId: string) => void;
}) {
  const open = Boolean(entry);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" aria-describedby={undefined}>
        {entry && (
          <ConnectFlow
            key={entry.id}
            entry={entry}
            onClose={() => onOpenChange(false)}
            onAlternative={onAlternative}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ConnectFlow({
  entry,
  onClose,
  onAlternative,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  onAlternative?: (catalogId: string) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const { data } = useIntegrations();
  const [startedId, setStartedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const current = data?.integrations.find((i) => i.id === startedId);
  const assistant = useAssistantName();
  // The provider whose own account brings services that only admit approved apps.
  const accountProvider = data?.providers.find((p) => p.account);
  const account = accountProvider?.account;
  const zapier = data?.catalog.find((c) => c.id === 'zapier');
  const zapierConnected = data?.integrations.some((i) => i.catalogId === 'zapier');
  const viaAccount = entry.auth === 'account';
  const external = useExternal(viaAccount);
  const found = viaAccount ? accountConnected(external.data?.servers, entry) : undefined;
  const phase: HandshakePhase = viaAccount
    ? found?.state === 'ok'
      ? 'connected'
      : external.isFetching
        ? 'waiting'
        : 'idle'
    : phaseOf(current);

  // Coming back from the provider's settings (or anywhere): look again straight away.
  useEffect(() => {
    if (!viaAccount) return;
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      void integrationsApi
        .external(true)
        .then((list) => client.setQueryData(integrationKeys.external, list))
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, [viaAccount, client]);

  // A first attempt that never worked leaves nothing behind when you walk away.
  useEffect(
    () => () => {
      const item = client
        .getQueryData<{ integrations: Integration[] }>(integrationKeys.all)
        ?.integrations.find((i) => i.id === startedId);
      if (item && !item.health.okAt && ['needs-auth', 'error'].includes(item.health.state)) {
        void integrationsApi.remove(item.id).catch(() => undefined);
      }
    },
    [client, startedId],
  );

  const tryIt = (prompt: string) => {
    onClose();
    void navigate('/', { state: { draft: prompt } });
  };

  const startOAuth = async () => {
    setError(undefined);
    const result = await signIn((display) =>
      current
        ? integrationsApi.connect(current.id, display)
        : integrationsApi.create({ catalogId: entry.id }, display),
    );
    if (result) setStartedId(result.integration.id);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const integration = current
        ? await integrationsApi.update(current.id, { values })
        : (await integrationsApi.create({ catalogId: entry.id, values })).integration;
      putIntegration(client, integration);
      setStartedId(integration.id);
    } catch (e) {
      setError(errorText(e, 'Couldn’t connect it.'));
    } finally {
      setBusy(false);
    }
  };

  const failure = !viaAccount && phase === 'failed' ? current?.health.message : undefined;
  const title =
    phase === 'connected'
      ? `${entry.name} is connected`
      : phase === 'waiting' && entry.auth === 'oauth'
        ? `Signing in to ${entry.name}…`
        : `Connect ${entry.name}`;

  return (
    <>
      <Dialog.Header className={styles.connectHeader}>
        <IntegrationHandshake
          name={entry.name}
          brand={entry.id}
          color={entry.color}
          phase={phase === 'waiting' && viaAccount ? 'idle' : phase}
        />
        <Dialog.Title className={styles.connectTitle}>{title}</Dialog.Title>
        <Text tone="muted" align="center" className={styles.connectLead}>
          {phase === 'connected'
            ? `${assistant} can use ${entry.name} in every chat now. It asks before it changes anything.`
            : entry.description}
        </Text>
      </Dialog.Header>

      <Dialog.Body>
        {phase === 'connected' ? (
          <Stack gap={5}>
            <TryIt entry={entry} onPick={tryIt} />
            {current?.health.state === 'warning' && (
              <Callout tone="warning">{current.health.message}</Callout>
            )}
          </Stack>
        ) : viaAccount ? (
          <AccountSteps
            entry={entry}
            account={account}
            provider={accountProvider?.engine}
            found={found?.state}
            alternative={
              zapier && !zapierConnected && onAlternative
                ? () => onAlternative(zapier.id)
                : undefined
            }
          />
        ) : (
          <Stack gap={5}>
            <AccessList entry={entry} />
            {entry.command && (
              <Callout tone="info" icon={<Monitor />} title="Runs on this computer">
                <Stack gap={2}>
                  <span>
                    Conch will start this program for {assistant}, as you
                    {entry.requires ? `. It needs ${entry.requires}.` : '.'}
                  </span>
                  <code className={styles.command}>{entry.command}</code>
                </Stack>
              </Callout>
            )}
            {entry.auth === 'token' && (
              <TokenForm
                entry={entry}
                values={values}
                onChange={setValues}
                onSubmit={submit}
                error={error ?? failure}
              />
            )}
            {entry.auth !== 'token' && (error ?? failure) && (
              <Callout tone="danger" live="polite">
                {error ?? failure}
              </Callout>
            )}
            {phase === 'waiting' && entry.auth === 'oauth' && (
              <Callout tone="info" live="polite">
                Finish signing in in the window that opened. Conch never sees your password.
              </Callout>
            )}
            {phase === 'waiting' && entry.auth === 'none' && (
              <Text size="sm" tone="muted" align="center" role="status">
                Setting it up — the first time can take a minute.
              </Text>
            )}
          </Stack>
        )}
      </Dialog.Body>

      <Dialog.Footer className={styles.connectFooter}>
        {phase === 'connected' ? (
          <>
            {current && (
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                  void navigate(`/integrations/${current.id}`);
                }}
              >
                Choose what it can do
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </>
        ) : viaAccount ? (
          <>
            <Button
              variant="ghost"
              leadingIcon={<RotateCw />}
              loading={external.isFetching}
              onClick={() =>
                void integrationsApi
                  .external(true)
                  .then((list) => client.setQueryData(integrationKeys.external, list))
              }
            >
              Check again
            </Button>
            {account && (
              <Button asChild trailingIcon={<ArrowUpRight />}>
                <a href={account.url} target="_blank" rel="noopener noreferrer">
                  Open settings
                </a>
              </Button>
            )}
          </>
        ) : entry.auth === 'oauth' ? (
          phase === 'waiting' ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  if (current)
                    void integrationsApi.cancel(current.id).then((i) => putIntegration(client, i));
                }}
              >
                Cancel
              </Button>
              <Button variant="surface" onClick={() => void startOAuth()}>
                Open the sign-in page again
              </Button>
            </>
          ) : (
            <Button size="lg" block onClick={() => void startOAuth()}>
              {phase === 'failed' ? 'Try again' : `Continue with ${entry.name}`}
            </Button>
          )
        ) : entry.auth === 'token' ? (
          <Button
            size="lg"
            block
            type="submit"
            form={`connect-${entry.id}`}
            loading={busy || phase === 'waiting'}
            leadingIcon={<KeyRound />}
          >
            Connect
          </Button>
        ) : (
          <Button
            size="lg"
            block
            onClick={() => void submit()}
            loading={busy || phase === 'waiting'}
          >
            {phase === 'failed' ? 'Try again' : `Add ${entry.name}`}
          </Button>
        )}
      </Dialog.Footer>
    </>
  );
}

function TokenForm({
  entry,
  values,
  onChange,
  onSubmit,
  error,
}: {
  entry: CatalogEntry;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  onSubmit: (event: FormEvent) => void;
  error?: string;
}) {
  const helpUrl = entry.fields.find((f) => f.helpUrl)?.helpUrl;
  const last = entry.fields.at(-1)?.key;
  return (
    <form id={`connect-${entry.id}`} onSubmit={onSubmit} className={styles.tokenForm} noValidate>
      {entry.steps.length > 0 && (
        <ol className={styles.steps}>
          {entry.steps.map((step, i) => (
            <li key={step}>
              <span className={styles.stepNumber} aria-hidden>
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {helpUrl && (
        <Button
          asChild
          variant="surface"
          trailingIcon={<ArrowUpRight />}
          className={styles.helpButton}
        >
          <a href={helpUrl} target="_blank" rel="noopener noreferrer">
            Open {entry.name}’s token page
          </a>
        </Button>
      )}
      {entry.fields.map((field) => {
        const value = values[field.key] ?? '';
        const shapeWrong =
          field.pattern && value.trim() && !new RegExp(field.pattern).test(value.trim());
        const message = shapeWrong ? field.patternHint : field.key === last ? error : undefined;
        return (
          <Field key={field.key} invalid={Boolean(message)} required={!field.optional}>
            <Field.Label>{field.label}</Field.Label>
            {field.secret ? (
              <PasswordInput
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                value={value}
                onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
                leading={<KeyRound />}
              />
            ) : (
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                value={value}
                onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
              />
            )}
            {message ? (
              <Field.Error>{message}</Field.Error>
            ) : (
              field.help && <Field.Description>{field.help}</Field.Description>
            )}
          </Field>
        );
      })}
      <Text size="xs" tone="subtle">
        Kept only on this computer, readable by you alone. Conch never shows it again.
      </Text>
    </form>
  );
}

function AccountSteps({
  entry,
  account,
  provider,
  found,
  alternative,
}: {
  entry: CatalogEntry;
  account?: IntegrationProvider['account'];
  /** The provider that brings it ("Claude Code"). */
  provider?: string;
  found?: string;
  /** Connect a service that reaches it for every model instead (Zapier). */
  alternative?: () => void;
}) {
  const where = account?.label ?? 'your AI provider’s account';
  return (
    <Stack gap={4}>
      <AccessList entry={entry} />
      <Text size="sm" tone="muted">
        {entry.name} only lets approved apps sign in, so it connects through {where} — and Conch
        picks it up from there.
      </Text>
      <ol className={styles.steps}>
        {[
          `Open the connector settings for ${where} (the button below).`,
          `Find ${entry.name} and press Connect.`,
          'Come back here. Conch notices by itself.',
        ].map((step, i) => (
          <li key={step}>
            <span className={styles.stepNumber} aria-hidden>
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {found === 'needs-auth' && (
        <Callout tone="warning">
          {entry.name} is in {where} but needs you to reconnect it there.
        </Callout>
      )}
      {account && !account.ready && account.hint && <Callout tone="info">{account.hint}</Callout>}
      {provider && (
        <Callout
          tone="info"
          title={`Only with ${provider} models`}
          action={
            alternative && (
              <Button size="sm" variant="surface" onClick={alternative}>
                Connect Zapier
              </Button>
            )
          }
        >
          {entry.name} comes through {where}, so other models you pick can’t reach it.
          {alternative
            ? ` To use ${entry.name} with every model, connect it through Zapier instead.`
            : ''}
        </Callout>
      )}
    </Stack>
  );
}

import { GoogleAppConnect } from './GoogleAppConnect';
import type { CatalogEntry, Integration } from '@conch/protocol';
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
import { ArrowUpRight, Check, CornerDownLeft, KeyRound, MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { integrationsApi, type SignInReturn } from './api';
import styles from './Integrations.module.css';
import { useLocalSetup } from './LocalSetup';
import {
  errorText,
  integrationKeys,
  putIntegration,
  useAssistantName,
  useIntegrations,
} from './queries';
import { SlackConnect } from './SlackConnect';
import { useSignIn } from './useSignIn';

function phaseOf(integration: Integration | undefined): HandshakePhase {
  // Waiting on something to install or switch on isn't a failure: the checklist says what.
  if (integration?.health.action === 'setup') return 'idle';
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
export function AccessList({ entry }: { entry: CatalogEntry }) {
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
function StandardConnectDialog({
  entry,
  existingId,
  onOpenChange,
  inChat,
  onAskAgain,
  back,
  onCloseAutoFocus,
}: {
  entry: CatalogEntry | undefined;
  /** Finish setting up one that's already added (its card said “Finish setup”). */
  existingId?: string;
  onOpenChange: (open: boolean) => void;
  /**
   * Opened from a chat's offer to connect: once connected it offers to ask
   * the question again, and nothing in it leads away from the chat.
   */
  inChat?: boolean;
  /** Send the chat's question again (closes the dialog first). */
  onAskAgain?: () => void;
  /** Opened from a chat's offer: signing in in this tab comes back to that chat (ADR 0055). */
  back?: SignInReturn;
  /** Where focus goes when it closes (the button that opened it may be gone by then). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const open = Boolean(entry);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        {entry && (
          <ConnectFlow
            key={entry.id}
            entry={entry}
            existingId={existingId}
            onClose={() => onOpenChange(false)}
            inChat={inChat}
            onAskAgain={onAskAgain}
            back={back}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ConnectFlow({
  entry,
  existingId,
  onClose,
  inChat,
  onAskAgain,
  back,
}: {
  entry: CatalogEntry;
  existingId?: string;
  onClose: () => void;
  inChat?: boolean;
  onAskAgain?: () => void;
  back?: SignInReturn;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const { data } = useIntegrations();
  const [startedId, setStartedId] = useState<string | undefined>(existingId);
  /** Added in this dialog (not one you came back to finish). */
  const createdHere = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const current = data?.integrations.find((i) => i.id === startedId);
  const assistant = useAssistantName();
  const phase: HandshakePhase = phaseOf(current);

  // A first attempt that never worked leaves nothing behind when you walk away —
  // unless it's only waiting on something being installed or switched on.
  useEffect(
    () => () => {
      if (!createdHere.current) return;
      const item = client
        .getQueryData<{ integrations: Integration[] }>(integrationKeys.all)
        ?.integrations.find((i) => i.id === startedId);
      if (
        item &&
        !item.health.okAt &&
        item.health.action !== 'setup' &&
        ['needs-auth', 'error'].includes(item.health.state)
      ) {
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
    if (!current) createdHere.current = true;
    const result = await signIn((display) =>
      current
        ? integrationsApi.connect(current.id, display, back)
        : integrationsApi.create({ catalogId: entry.id }, display, back),
    );
    if (result) setStartedId(result.integration.id);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(undefined);
    if (!current) createdHere.current = true;
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

  const setup = useLocalSetup(entry, current, () => void submit());
  const failure =
    phase === 'failed' && current?.health.action !== 'setup' ? current?.health.message : undefined;
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
          phase={phase}
        />
        <Dialog.Title className={styles.connectTitle}>{title}</Dialog.Title>
        <Text tone="muted" align="center" className={styles.connectLead}>
          {phase === 'connected'
            ? `${assistant} can use ${entry.name} in every chat now. It asks before it changes anything.`
            : entry.description}
        </Text>
      </Dialog.Header>

      {/* In a chat, connected says it all in the header and the buttons. */}
      {!(inChat && phase === 'connected' && current?.health.state !== 'warning') && (
        <Dialog.Body>
          {phase === 'connected' ? (
            <Stack gap={5}>
              {/* In a chat, the question to try is the one just asked. */}
              {!inChat && <TryIt entry={entry} onPick={tryIt} />}
              {current?.health.state === 'warning' && (
                <Callout tone="warning">{current.health.message}</Callout>
              )}
            </Stack>
          ) : (
            <Stack gap={5}>
              <AccessList entry={entry} />
              {setup.checklist}
              {entry.auth === 'token' && (
                <TokenForm
                  entry={entry}
                  values={values}
                  onChange={setValues}
                  onSubmit={submit}
                  error={error ?? failure}
                />
              )}
              {entry.auth !== 'token' && (error ?? setup.error ?? failure) && (
                <Callout tone="danger" live="polite">
                  {error ?? setup.error ?? failure}
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
      )}

      <Dialog.Footer className={styles.connectFooter}>
        {phase === 'connected' && inChat ? (
          <>
            <Button variant={onAskAgain ? 'ghost' : 'solid'} onClick={onClose}>
              Done
            </Button>
            {onAskAgain && (
              <Button
                leadingIcon={<CornerDownLeft />}
                onClick={() => {
                  onClose();
                  onAskAgain();
                }}
              >
                Ask again
              </Button>
            )}
          </>
        ) : phase === 'connected' ? (
          <>
            {current && (
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                  void navigate(`/apps/${current.id}`);
                }}
              >
                Choose what it can do
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
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
          (setup.primary ?? (
            <Button
              size="lg"
              block
              onClick={() => void submit()}
              loading={busy || phase === 'waiting' || current?.health.state === 'checking'}
            >
              {phase === 'failed'
                ? 'Try again'
                : current?.health.action === 'setup'
                  ? 'Check again'
                  : `Add ${entry.name}`}
            </Button>
          ))
        )}
      </Dialog.Footer>
      {setup.dialog}
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

export function ConnectDialog(props: Parameters<typeof StandardConnectDialog>[0]) {
  // Gmail, Google Calendar and Google Drive: one Google account, each asking only for what it needs.
  if (props.entry?.auth === 'google') {
    const entry = props.entry;
    return (
      <Dialog.Root open onOpenChange={(open) => !open && props.onOpenChange(false)}>
        <Dialog.Content
          size="md"
          aria-describedby={undefined}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <GoogleAppConnect
            key={entry.id}
            entry={entry}
            onClose={() => props.onOpenChange(false)}
            inChat={props.inChat}
            onAskAgain={props.onAskAgain}
          />
        </Dialog.Content>
      </Dialog.Root>
    );
  }
  if (props.entry?.auth === 'slack')
    return (
      <Dialog.Root open onOpenChange={(open) => !open && props.onOpenChange(false)}>
        <Dialog.Content
          size="md"
          aria-describedby={undefined}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <SlackConnect
            entry={props.entry}
            inChat={props.inChat}
            onClose={() => props.onOpenChange(false)}
            onAskAgain={props.onAskAgain}
          />
        </Dialog.Content>
      </Dialog.Root>
    );
  return <StandardConnectDialog {...props} />;
}

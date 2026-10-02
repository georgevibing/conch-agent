import type { Integration, IntegrationPolicy } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  EmptyState,
  Field,
  Heading,
  humanizeTool,
  Input,
  IntegrationLogo,
  IntegrationStatusBadge,
  PasswordInput,
  SegmentedControl,
  Skeleton,
  Stack,
  Switch,
  Text,
  ToolPermissionList,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, RotateCw, Unplug } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { relativeTime } from '../../lib/time';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { integrationsApi } from './api';
import { TryIt } from './ConnectDialog';
import { APP_PASSWORDS_URL, GoogleAppConnection } from './GoogleAppConnect';
import { fixLabel, needsAttention } from './describe';
import { GetIt } from '../setup/GetIt';
import styles from './Integrations.module.css';
import { useSignInResult } from './useSignInResult';
import { AppAbilitiesSection } from './AppAbilitiesSection';
import type { AppItem } from './apps';
import { APPS_PATH } from './paths';
import {
  errorText,
  putIntegration,
  useCheckIntegration,
  useIntegration,
  useAssistantName,
  useRemoveIntegration,
  useUpdateIntegration,
} from './queries';
import { SlackConnection } from './SlackConnect';
import { useFix } from './useFix';

const policyHelp: Record<IntegrationPolicy, (name: string, assistant: string) => string> = {
  ask: (name, assistant) => `${assistant} asks you before every action in ${name}.`,
  'ask-writes': (_name, assistant) =>
    `${assistant} looks things up on its own, and asks before it creates, sends, changes or deletes anything.`,
  trust: (name, assistant) =>
    `${assistant} acts in ${name} without asking. Only choose this if mistakes there are easy to undo — something it reads could try to trick it.`,
};

export function IntegrationDetailView({
  integrationId,
  item,
  onSetUp,
}: {
  integrationId: string;
  /** The whole app it's a half of (ADR 0052), for its switches. */
  item?: AppItem;
  /** Opens the app's connect dialog, kept by the page. */
  onSetUp?: () => void;
}) {
  useSignInResult();
  const { integration, entry, isPending } = useIntegration(integrationId);
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div className={styles.page}>
        <Skeleton shape="block" height="4.5rem" />
        <Skeleton shape="block" height="12rem" />
      </div>
    );
  }
  if (!integration) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="This app isn’t here any more"
          description="It may have been disconnected on another device."
          actions={<Button onClick={() => void navigate(APPS_PATH)}>See all apps</Button>}
        />
      </div>
    );
  }
  return (
    <Detail
      integration={integration}
      color={entry?.color}
      entry={entry}
      item={item}
      onSetUp={onSetUp}
    />
  );
}

function Detail({
  integration,
  color,
  entry,
  item,
  onSetUp,
}: {
  integration: Integration;
  color?: string;
  entry: ReturnType<typeof useIntegration>['entry'];
  item?: AppItem;
  onSetUp?: () => void;
}) {
  const navigate = useNavigate();
  const update = useUpdateIntegration();
  const check = useCheckIntegration();
  const remove = useRemoveIntegration();
  const { fix } = useFix();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const assistant = useAssistantName();
  const [confirm, setConfirm] = useState(false);
  const location = useLocation();
  const slack = integration.id === 'slack';
  // Slack connects again in its own dialog: opened from a card's "Sign in again" too.
  const [reconnect, setReconnect] = useState(
    slack && (location.state as { focus?: string } | null)?.focus === 'token',
  );
  const { health } = integration;
  const attention = needsAttention(integration);
  const label = fixLabel(integration);
  const prefix = new RegExp(`^${integration.server.replace(/[-_]\d+$/, '')}[-_]`, 'i');

  useEffect(() => {
    document.title = `${integration.name} · Conch`;
  }, [integration.name]);

  const setPolicy = (policy: IntegrationPolicy) =>
    void guard(() => integrationsApi.update(integration.id, { policy })).then(() => update.reset());

  return (
    <div className={styles.page}>
      <div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<ArrowLeft />}
          onClick={() => void navigate(APPS_PATH)}
        >
          Apps
        </Button>
      </div>

      <header className={styles.detailHeader}>
        <IntegrationLogo
          brand={integration.catalogId ?? 'custom'}
          name={integration.name}
          color={color}
          size="xl"
          status={integration.enabled ? health.state : 'off'}
          decorative
        />
        <Stack gap={1} className={styles.detailTitle}>
          <Heading level={1} size="2xl">
            {integration.name}
          </Heading>
          <Stack direction="row" gap={2} align="center" wrap>
            <IntegrationStatusBadge state={integration.enabled ? health.state : 'off'} />
            {entry && (
              <Text as="span" size="sm" tone="muted">
                {entry.tagline}
              </Text>
            )}
          </Stack>
        </Stack>
        <label className={styles.detailSwitch}>
          <Text as="span" size="sm" tone="muted">
            {integration.enabled ? 'On' : 'Off'}
          </Text>
          <Switch
            checked={integration.enabled}
            aria-label={
              integration.enabled ? `Turn off ${integration.name}` : `Turn on ${integration.name}`
            }
            onCheckedChange={(enabled) => update.mutate({ id: integration.id, patch: { enabled } })}
          />
        </label>
      </header>

      {attention && health.message && (
        <Callout
          tone={health.state === 'error' ? 'danger' : 'warning'}
          title={health.message}
          live="polite"
          action={
            label &&
            !health.need && (
              <Button
                size="sm"
                onClick={() =>
                  slack && health.action === 'reconnect' ? setReconnect(true) : fix(integration)
                }
                loading={check.isPending}
              >
                {label}
              </Button>
            )
          }
        >
          {health.need && (
            <GetIt
              needId={health.need}
              lead="It runs with a program that isn’t on this computer yet. Conch can install it, then connects by itself."
            />
          )}
          {(health.okAt || health.detail || health.retryAt) && (
            <Stack gap={2}>
              {health.okAt && <span>It last worked {relativeTime(health.okAt)}.</span>}
              {health.retryAt && health.state === 'error' && (
                <span>Conch keeps trying by itself — there’s nothing you need to do.</span>
              )}
              {health.detail && (
                <details className={styles.detail}>
                  <summary>What the app said</summary>
                  <code>{health.detail}</code>
                </details>
              )}
            </Stack>
          )}
        </Callout>
      )}
      {!integration.enabled && (
        <Callout tone="info" title="Off">
          {assistant} can’t see {integration.name} while it’s off. Your sign-in is kept for when you
          turn it back on.
        </Callout>
      )}

      <AppAbilitiesSection
        onSetUp={onSetUp}
        item={
          item ?? {
            key: integration.id,
            name: integration.name,
            brand: integration.catalogId ?? 'custom',
            integration,
            ...(entry && { entry }),
            channels: [],
            to: '',
            talks: false,
          }
        }
      />

      <section className={styles.section} aria-labelledby="int-policy">
        <Heading level={2} id="int-policy" size="md">
          When {assistant} uses {integration.name}
        </Heading>
        <SegmentedControl
          value={integration.policy}
          onValueChange={(v) => setPolicy(v as IntegrationPolicy)}
          aria-labelledby="int-policy"
          className={styles.policy}
        >
          <SegmentedControl.Item value="ask">Ask every time</SegmentedControl.Item>
          <SegmentedControl.Item value="ask-writes">Ask before changes</SegmentedControl.Item>
          <SegmentedControl.Item value="trust">Don’t ask</SegmentedControl.Item>
        </SegmentedControl>
        <Text
          size="sm"
          tone={integration.policy === 'trust' ? 'default' : 'muted'}
          className={styles.policyHelp}
        >
          {policyHelp[integration.policy](integration.name, assistant)}
          {integration.tools.some((t) => t.alwaysAsks) &&
            (slack
              ? ' Sending a message always asks, whatever you choose here.'
              : ' Saving a draft always asks, whatever you choose here, and nothing is ever sent.')}
        </Text>
      </section>

      <section className={styles.section} aria-labelledby="int-tools">
        <Stack gap={0.5}>
          <Heading level={2} id="int-tools" size="md">
            Each tool
          </Heading>
          <Text size="sm" tone="muted">
            Choose for each one, or turn off what you don’t need — {assistant} stays more focused
            with fewer tools.
          </Text>
        </Stack>
        {integration.tools.length ? (
          <ToolPermissionList
            policy={integration.policy}
            tools={integration.tools.map((t) => ({
              ...t,
              title: t.title ?? humanizeTool(t.name.replace(prefix, '')),
            }))}
            onChange={(tool, policy) =>
              update.mutate({ id: integration.id, patch: { tools: { [tool]: policy } } })
            }
          />
        ) : (
          <Text size="sm" tone="subtle">
            {health.state === 'ok' || health.state === 'warning'
              ? 'It doesn’t offer anything yet.'
              : 'Its tools show up here once it’s connected.'}
          </Text>
        )}
      </section>

      {entry && (health.state === 'ok' || health.state === 'warning') && integration.enabled && (
        <section className={styles.section}>
          <TryIt entry={entry} onPick={(draft) => void navigate('/', { state: { draft } })} />
        </section>
      )}

      {slack && entry ? (
        <SlackConnection
          integration={integration}
          entry={entry}
          onCheck={() => check.mutate(integration.id)}
          checking={check.isPending}
          reconnect={reconnect}
          onReconnect={setReconnect}
        />
      ) : integration.transport.type === 'host' ? (
        <GoogleAppConnection
          integration={integration}
          onCheck={() => check.mutate(integration.id)}
          checking={check.isPending}
        />
      ) : (
        <Connection
          integration={integration}
          onCheck={() => check.mutate(integration.id)}
          checking={check.isPending}
        />
      )}

      <section className={styles.dangerZone}>
        <Button
          variant="ghost"
          tone="danger"
          leadingIcon={<Unplug />}
          onClick={() => setConfirm(true)}
        >
          Disconnect {integration.name}
        </Button>
      </section>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger" icon={<Unplug />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Disconnect {integration.name}?</AlertDialog.Title>
            <AlertDialog.Description>
              {slack ? (
                <>
                  {assistant} won’t be able to use Slack any more. Conch forgets the sign-in and
                  asks Slack to forget it too. Your Slack app stays in your workspace.
                </>
              ) : integration.transport.type === 'host' ? (
                <>
                  {assistant} won’t be able to use it any more. A Google account that no other
                  Google app uses is disconnected too
                  {integration.auth === 'token' ? (
                    <>
                      , and Conch forgets its app password. To stop that password working at Google
                      as well, remove it on{' '}
                      <a href={APP_PASSWORDS_URL} target="_blank" rel="noopener noreferrer">
                        Google’s app passwords page
                      </a>
                      .
                    </>
                  ) : (
                    ', and its access is taken back at Google.'
                  )}
                </>
              ) : (
                <>
                  {assistant} won’t be able to use it any more, and Conch forgets its sign-in.
                  {integration.auth === 'oauth' &&
                    ` To remove Conch from your ${integration.name} account too, look for “connected apps” in ${integration.name}’s settings.`}
                </>
              )}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              tone="danger"
              onClick={() => {
                remove.mutate(integration);
                void navigate(APPS_PATH);
              }}
            >
              Disconnect
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </div>
  );
}

function Connection({
  integration,
  onCheck,
  checking,
}: {
  integration: Integration;
  onCheck: () => void;
  checking: boolean;
}) {
  const client = useQueryClient();
  const location = useLocation();
  const { data } = useIntegration(integration.id);
  const entry = data?.catalog.find((c) => c.id === integration.catalogId);
  const focusToken = (location.state as { focus?: string } | null)?.focus === 'token';
  const [editing, setEditing] = useState(focusToken);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const first = useRef<HTMLInputElement>(null);
  const { transport } = integration;
  const fields =
    entry?.fields ??
    (integration.auth === 'token' || (transport.type === 'http' && integration.auth !== 'oauth')
      ? [{ key: 'token', label: 'Access token', secret: true, optional: false }]
      : []);

  useEffect(() => {
    if (editing) first.current?.focus();
  }, [editing]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const updated = await integrationsApi.update(integration.id, { values });
      putIntegration(client, updated);
      if (updated.health.state === 'ok' || updated.health.state === 'warning') {
        setEditing(false);
        setValues({});
        toast.success(`${integration.name} is working`);
      } else {
        setError(updated.health.message);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const how =
    transport.type === 'stdio'
      ? 'Runs on this computer'
      : integration.auth === 'oauth'
        ? `Signed in with ${integration.name}`
        : integration.auth === 'token'
          ? 'With an access token'
          : 'No sign-in needed';

  return (
    <section className={styles.section} aria-labelledby="int-connection">
      <Heading level={2} id="int-connection" size="md">
        Connection
      </Heading>
      <dl className={styles.facts}>
        <div>
          <dt>How</dt>
          <dd>{how}</dd>
        </div>
        <div>
          <dt>{transport.type === 'stdio' ? 'Program' : 'Address'}</dt>
          <dd>
            <code className={styles.command}>
              {transport.type === 'stdio'
                ? [transport.command, ...transport.args].join(' ')
                : transport.type === 'http'
                  ? transport.url
                  : transport.how}
            </code>
          </dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>
            {integration.health.checkedAt ? relativeTime(integration.health.checkedAt) : 'Not yet'}
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<RotateCw />}
              onClick={onCheck}
              loading={checking}
            >
              Check now
            </Button>
          </dd>
        </div>
      </dl>

      {fields.length > 0 &&
        (editing ? (
          <form onSubmit={save} className={styles.tokenForm} noValidate>
            {fields.map((field, i) => {
              const saved = integration.secrets.includes(field.key);
              return (
                <Field key={field.key} invalid={Boolean(error) && i === fields.length - 1}>
                  <Field.Label>{field.label}</Field.Label>
                  {field.secret ? (
                    <PasswordInput
                      ref={i === 0 ? first : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        saved ? 'Saved — paste a new one to replace it' : field.placeholder
                      }
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      leading={<KeyRound />}
                    />
                  ) : (
                    <Input
                      ref={i === 0 ? first : undefined}
                      autoComplete="off"
                      value={values[field.key] ?? integration.values[field.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    />
                  )}
                  {error && i === fields.length - 1 ? (
                    <Field.Error>{error}</Field.Error>
                  ) : (
                    field.help && <Field.Description>{field.help}</Field.Description>
                  )}
                </Field>
              );
            })}
            <Stack direction="row" gap={2}>
              <Button
                type="submit"
                loading={busy}
                disabled={!Object.values(values).some((v) => v.trim())}
              >
                Save and check
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Stack>
          </form>
        ) : (
          <div>
            <Button
              variant="surface"
              size="sm"
              leadingIcon={<KeyRound />}
              onClick={() => setEditing(true)}
            >
              {fields.some((f) => f.secret) ? 'Replace token' : 'Change settings'}
            </Button>
          </div>
        ))}
    </section>
  );
}

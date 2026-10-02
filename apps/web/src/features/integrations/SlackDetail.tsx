import type { CatalogEntry, SlackStatus } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  Dialog,
  EmptyState,
  Heading,
  IntegrationCard,
  IntegrationLogo,
  IntegrationStatusBadge,
  Skeleton,
  Stack,
  Switch,
  Text,
  ToolPermissionList,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCw, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { relativeTime } from '../../lib/time';
import { TryIt } from './ConnectDialog';
import styles from './Integrations.module.css';
import { errorText, useAssistantName, useIntegrations } from './queries';
import { SlackConnect } from './SlackConnect';
import { slackApi, slackKeys, useSlack, useUpdateSlack } from './slackApi';

/** "4 tools · used 2 hours ago", like any other connected app. */
function metaOf(status: SlackStatus, now = Date.now()): string {
  const count = status.tools.filter((t) => t.policy !== 'off').length;
  const tools = count === 1 ? '1 tool' : `${count} tools`;
  const used = status.lastUsedAt ? `used ${relativeTime(status.lastUsedAt, now)}` : 'not used yet';
  return `${tools} · ${used}`;
}

const attention = (status: SlackStatus) =>
  status.enabled && ['needs-auth', 'error', 'warning'].includes(status.health.state);

/** Slack among the connected apps on the Integrations page (ADR 0049). */
export function SlackCard({ status, entry }: { status: SlackStatus; entry: CatalogEntry }) {
  const navigate = useNavigate();
  const update = useUpdateSlack();
  const open = () => void navigate('/integrations/slack');
  return (
    <IntegrationCard
      variant="connected"
      name={entry.name}
      brand={entry.id}
      color={entry.color}
      state={status.enabled ? status.health.state : 'off'}
      message={status.health.message}
      meta={metaOf(status)}
      enabled={status.enabled}
      action={
        attention(status)
          ? {
              label: status.health.state === 'error' ? 'Try again' : 'Connect again',
              onClick: open,
            }
          : undefined
      }
      onToggle={(enabled) => update.mutate({ enabled })}
      onOpen={open}
    />
  );
}

/** `/integrations/slack`: what Slack may do, how it's connected, and disconnecting it. */
export function SlackDetailView() {
  const { data: status, isPending } = useSlack();
  const { data: list } = useIntegrations();
  const entry = list?.catalog.find((c) => c.id === 'slack');
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Slack · Conch';
  }, []);

  if (isPending || !list) {
    return (
      <div className={styles.page}>
        <Skeleton shape="block" height="4.5rem" />
        <Skeleton shape="block" height="12rem" />
      </div>
    );
  }
  if (!status?.connected || !entry) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Slack isn’t connected"
          description="It may have been disconnected on another device."
          actions={
            <Button onClick={() => void navigate('/integrations?connect=slack')}>
              Connect Slack
            </Button>
          }
        />
      </div>
    );
  }
  return <Detail status={status} entry={entry} />;
}

function Detail({ status, entry }: { status: SlackStatus; entry: CatalogEntry }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const update = useUpdateSlack();
  const assistant = useAssistantName();
  const [confirm, setConfirm] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const [checking, setChecking] = useState(false);
  const { health } = status;
  const state = status.enabled ? health.state : 'off';

  const check = async () => {
    setChecking(true);
    try {
      client.setQueryData(slackKeys.status, await slackApi.check());
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setChecking(false);
    }
  };

  const disconnect = async () => {
    try {
      await slackApi.disconnect();
      await client.invalidateQueries({ queryKey: slackKeys.status });
      toast('Disconnected Slack');
      void navigate('/integrations');
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t disconnect it.'));
    }
  };

  return (
    <div className={styles.page}>
      <div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<ArrowLeft />}
          onClick={() => void navigate('/integrations')}
        >
          Integrations
        </Button>
      </div>

      <header className={styles.detailHeader}>
        <IntegrationLogo
          brand={entry.id}
          name={entry.name}
          color={entry.color}
          size="xl"
          status={state}
          decorative
        />
        <Stack gap={1} className={styles.detailTitle}>
          <Heading level={1} size="2xl">
            {entry.name}
          </Heading>
          <Stack direction="row" gap={2} align="center" wrap>
            <IntegrationStatusBadge state={state} />
            <Text as="span" size="sm" tone="muted">
              {status.workspace ?? entry.tagline}
              {status.user ? ` · as ${status.user}` : ''}
            </Text>
          </Stack>
        </Stack>
        <label className={styles.detailSwitch}>
          <Text as="span" size="sm" tone="muted">
            {status.enabled ? 'On' : 'Off'}
          </Text>
          <Switch
            checked={status.enabled}
            aria-label={status.enabled ? 'Turn off Slack' : 'Turn on Slack'}
            onCheckedChange={(enabled) => update.mutate({ enabled })}
          />
        </label>
      </header>

      {attention(status) && health.message && (
        <Callout
          tone={health.state === 'error' ? 'danger' : 'warning'}
          title={health.message}
          live="polite"
          action={
            health.state === 'error' ? (
              <Button size="sm" onClick={() => void check()} loading={checking}>
                Try again
              </Button>
            ) : (
              <Button size="sm" onClick={() => setReconnect(true)}>
                Connect again
              </Button>
            )
          }
        >
          {health.okAt && <span>It last worked {relativeTime(health.okAt)}.</span>}
        </Callout>
      )}
      {!status.enabled && (
        <Callout tone="info" title="Off">
          {assistant} can’t see Slack while it’s off. Your sign-in is kept for when you turn it back
          on.
        </Callout>
      )}

      <section className={styles.section} aria-labelledby="slack-tools">
        <Stack gap={0.5}>
          <Heading level={2} id="slack-tools" size="md">
            What {assistant} can do in Slack
          </Heading>
          <Text size="sm" tone="muted">
            It looks things up on its own, and shows you every message before it sends one. Works
            with every model you pick.
          </Text>
        </Stack>
        <ToolPermissionList
          policy="ask-writes"
          tools={status.tools}
          onChange={(tool, policy) =>
            update.mutate({ tools: { [tool]: policy } as Record<string, typeof policy> })
          }
        />
      </section>

      {status.enabled && (health.state === 'ok' || health.state === 'warning') && (
        <section className={styles.section}>
          <TryIt entry={entry} onPick={(draft) => void navigate('/', { state: { draft } })} />
        </section>
      )}

      <section className={styles.section} aria-labelledby="slack-connection">
        <Heading level={2} id="slack-connection" size="md">
          Connection
        </Heading>
        <dl className={styles.facts}>
          <div>
            <dt>How</dt>
            <dd>With your own Slack app, connected to Conch itself</dd>
          </div>
          {status.workspace && (
            <div>
              <dt>Workspace</dt>
              <dd>{status.workspace}</dd>
            </div>
          )}
          <div>
            <dt>Checked</dt>
            <dd>
              {health.checkedAt ? relativeTime(health.checkedAt) : 'Not yet'}
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<RotateCw />}
                onClick={() => void check()}
                loading={checking}
              >
                Check now
              </Button>
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.dangerZone}>
        <Button
          variant="ghost"
          tone="danger"
          leadingIcon={<Unplug />}
          onClick={() => setConfirm(true)}
        >
          Disconnect Slack
        </Button>
      </section>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger" icon={<Unplug />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Disconnect Slack?</AlertDialog.Title>
            <AlertDialog.Description>
              {assistant} won’t be able to use Slack any more. Conch forgets the sign-in and asks
              Slack to forget it too. Your Slack app stays in your workspace.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => void disconnect()}>
              Disconnect
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <Dialog.Root open={reconnect} onOpenChange={setReconnect}>
        <Dialog.Content size="md" aria-describedby={undefined}>
          {reconnect && <SlackConnect entry={entry} again onClose={() => setReconnect(false)} />}
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

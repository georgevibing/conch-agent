import { SLACK_USER_TOKEN, type CatalogEntry, type Integration } from '@conch/protocol';
import {
  Button,
  Callout,
  CodeBlock,
  Collapsible,
  Dialog,
  Field,
  Heading,
  IntegrationHandshake,
  PasswordInput,
  Stack,
  Text,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CornerDownLeft, KeyRound, RotateCw } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { relativeTime } from '../../lib/time';
import { slackAppUrl, slackCreateUrl, slackManifest } from '../channels/guides';
import { AccessList, TryIt } from './ConnectDialog';
import styles from './Integrations.module.css';
import { errorText, putIntegration, useAssistantName, useIntegration } from './queries';
import { slackApi, useSlackSetup, works } from './slackApi';

function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className={styles.steps}>
      {steps.map((step, i) => (
        <li key={i}>
          <span className={styles.stepNumber} aria-hidden>
            {i + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="surface" trailingIcon={<ArrowUpRight />} className={styles.helpButton}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    </Button>
  );
}

/**
 * Connecting Slack to Conch itself (ADR 0049), so it works with every model.
 * The person makes a Slack app in their own workspace from settings Conch
 * fills in — or, when a Slack channel already has one, uses that same app,
 * after saying so — then pastes the one token it shows. Nothing else.
 */
export function SlackConnect({
  entry,
  inChat,
  again,
  onClose,
  onAskAgain,
}: {
  entry: CatalogEntry;
  inChat?: boolean;
  /** Connecting again (a refused sign-in, a missing permission): the form, whatever the state. */
  again?: boolean;
  onClose: () => void;
  onAskAgain?: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const assistant = useAssistantName();
  const { integration } = useIntegration('slack');
  const { data: setup, isPending: asking } = useSlackSetup(!again);
  const [choice, setChoice] = useState<'reuse' | 'new'>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showManifest, setShowManifest] = useState(false);
  const [done, setDone] = useState(false);

  const connected = again ? done : works(integration);
  const app = again ? undefined : setup?.channelApp;
  // Until Conch knows whether there's an app to offer, neither path shows (no flicker).
  const known = again || !asking;
  // Asked, never assumed: the channel's app is only used once the person says so.
  const reuse = choice === 'reuse' && app;
  const manifest = JSON.stringify(slackManifest(assistant), null, 2);

  const connect = async (value = token, event?: FormEvent) => {
    event?.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      putIntegration(client, await slackApi.connect(value));
      setToken('');
      setDone(true);
    } catch (e) {
      const message = errorText(e, 'Couldn’t check that with Slack.');
      setError(message);
      // An app made before Slack with every model: show how to give it what it needs.
      if (/can’t .* yet/.test(message)) setShowManifest(true);
    } finally {
      setBusy(false);
    }
  };

  const tryIt = (prompt: string) => {
    onClose();
    void navigate('/', { state: { draft: prompt } });
  };

  return (
    <>
      <Dialog.Header className={styles.connectHeader}>
        <IntegrationHandshake
          name={entry.name}
          brand={entry.id}
          color={entry.color}
          phase={connected ? 'connected' : busy ? 'waiting' : error ? 'failed' : 'idle'}
        />
        <Dialog.Title className={styles.connectTitle}>
          {connected ? 'Slack is connected' : 'Connect Slack'}
        </Dialog.Title>
        <Text tone="muted" align="center" className={styles.connectLead}>
          {connected
            ? `${assistant} can use Slack in every chat now, with every model. It shows you every message before it sends one.`
            : `${entry.description} Works with every model you pick.`}
        </Text>
      </Dialog.Header>

      {!(inChat && connected) && (
        <Dialog.Body>
          {connected ? (
            !inChat && <TryIt entry={entry} onPick={tryIt} />
          ) : (
            <Stack gap={5}>
              <AccessList entry={entry} />
              {app && !choice && (
                <Callout
                  tone="info"
                  title={`Use ${app.name}, the Slack app you already made?`}
                  action={
                    <Stack direction="row" gap={2}>
                      <Button size="sm" onClick={() => setChoice('reuse')}>
                        Use it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setChoice('new')}>
                        Make a new one
                      </Button>
                    </Stack>
                  }
                >
                  You made it to chat with {assistant}
                  {app.workspace ? ` in ${app.workspace}` : ''}. The same app can read and send for
                  you too: it then needs one more key, the one that acts as you.
                </Callout>
              )}
              {known && (!app || choice) && (
                <form
                  id="connect-slack"
                  className={styles.tokenForm}
                  onSubmit={(e) => void connect(token, e)}
                  noValidate
                >
                  {reuse ? (
                    <>
                      <Steps
                        steps={[
                          <>
                            Open your app’s <b>Install App</b> page. If Slack offers{' '}
                            <b>Reinstall to Workspace</b>, press it, then <b>Allow</b>.
                          </>,
                          <>
                            Copy the <b>User OAuth Token</b> (it starts with xoxp-) and paste it
                            here.
                          </>,
                        ]}
                      />
                      <OpenLink href={slackAppUrl(app.appId, 'install-on-team')}>
                        Open your app’s Install App page
                      </OpenLink>
                    </>
                  ) : (
                    <>
                      <Steps
                        steps={[
                          <>
                            Make the app: Slack opens with everything filled in. Pick your
                            workspace, press <b>Next</b>, then <b>Create</b>.
                          </>,
                          <>
                            Open <b>Install App</b>, press <b>Install to Workspace</b>, then{' '}
                            <b>Allow</b>.
                          </>,
                          <>
                            Copy the <b>User OAuth Token</b> (it starts with xoxp-) and paste it
                            here.
                          </>,
                        ]}
                      />
                      <OpenLink href={slackCreateUrl(assistant)}>Make the app in Slack</OpenLink>
                    </>
                  )}
                  <Field invalid={Boolean(error)} required>
                    <Field.Label>User OAuth Token</Field.Label>
                    <PasswordInput
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="xoxp-…"
                      value={token}
                      leading={<KeyRound />}
                      onChange={(e) => {
                        const value = e.target.value;
                        setToken(value);
                        setError(undefined);
                        // Pasted whole: check it at once, no button to find.
                        if (SLACK_USER_TOKEN.test(value.trim()) && value.length - token.length > 10)
                          void connect(value);
                      }}
                    />
                    {error ? (
                      <Field.Error>{error}</Field.Error>
                    ) : (
                      <Field.Description>
                        It lets {assistant} read and send as you. Kept only on this computer, and
                        never shown again.
                      </Field.Description>
                    )}
                  </Field>
                  <Collapsible open={showManifest} onOpenChange={setShowManifest}>
                    <Collapsible.Trigger asChild>
                      <Button variant="ghost" size="sm" className={styles.helpButton}>
                        {reuse ? 'No User OAuth Token there?' : 'Slack showed an empty form?'}
                      </Button>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <Stack gap={2}>
                        <Text size="sm" tone="muted">
                          {reuse ? (
                            <>
                              Your app was made before it could read Slack for you. Open its{' '}
                              <b>App Manifest</b>, put this in place of what’s there, press{' '}
                              <b>Save</b>, then <b>Reinstall to Workspace</b> on the Install App
                              page.
                            </>
                          ) : (
                            <>
                              Press <b>Create New App</b> → <b>From a manifest</b>, pick your
                              workspace, and paste this in place of what’s there.
                            </>
                          )}
                        </Text>
                        {reuse && (
                          <OpenLink href={slackAppUrl(app.appId, 'app-manifest')}>
                            Open your app’s manifest
                          </OpenLink>
                        )}
                        <CodeBlock
                          code={manifest}
                          language="json"
                          filename="Slack app settings"
                          maxLines={10}
                        />
                      </Stack>
                    </Collapsible.Content>
                  </Collapsible>
                </form>
              )}
            </Stack>
          )}
        </Dialog.Body>
      )}

      <Dialog.Footer className={styles.connectFooter}>
        {connected && inChat ? (
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
        ) : connected ? (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                void navigate('/integrations/slack');
              }}
            >
              Choose what it can do
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          known &&
          (!app || choice) && (
            <Button
              size="lg"
              block
              type="submit"
              form="connect-slack"
              loading={busy}
              disabled={!token.trim()}
              leadingIcon={<KeyRound />}
            >
              Connect
            </Button>
          )
        )}
      </Dialog.Footer>
    </>
  );
}

/**
 * The Connection section of Slack's page: how it's connected, as whom, when
 * it was last checked — and, when Slack stopped taking the token or an older
 * app is missing a permission, the dialog that connects it again.
 */
export function SlackConnection({
  integration,
  entry,
  onCheck,
  checking,
  reconnect,
  onReconnect,
}: {
  integration: Integration;
  entry: CatalogEntry;
  onCheck: () => void;
  checking: boolean;
  reconnect: boolean;
  onReconnect: (open: boolean) => void;
}) {
  const { health } = integration;
  return (
    <section className={styles.section} aria-labelledby="int-connection">
      <Heading level={2} id="int-connection" size="md">
        Connection
      </Heading>
      <dl className={styles.facts}>
        <div>
          <dt>How</dt>
          <dd>{integration.transport.type === 'host' ? integration.transport.how : ''}</dd>
        </div>
        {integration.account && (
          <div>
            <dt>Account</dt>
            <dd>{integration.account}</dd>
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
              onClick={onCheck}
              loading={checking}
            >
              Check now
            </Button>
          </dd>
        </div>
      </dl>
      <div>
        <Button
          variant="surface"
          size="sm"
          leadingIcon={<KeyRound />}
          onClick={() => onReconnect(true)}
        >
          Connect again
        </Button>
      </div>
      <Dialog.Root open={reconnect} onOpenChange={onReconnect}>
        <Dialog.Content size="md" aria-describedby={undefined}>
          {reconnect && <SlackConnect entry={entry} again onClose={() => onReconnect(false)} />}
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}

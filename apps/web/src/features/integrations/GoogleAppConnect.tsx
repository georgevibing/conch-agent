import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from '../channels/api';
import { whoOf } from '../channels/describe';
import { putChannel, useChannels } from '../channels/queries';
import type { CatalogEntry, Channel, GoogleAppId, Integration } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  IntegrationHandshake,
  Stack,
  Text,
  type HandshakePhase,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CornerDownLeft, MessageCircle, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { WhenStarters } from '../routines/WhenStarters';
import { TryIt } from './ConnectDialog';
import { APP_PASSWORDS_URL, GmailPassword } from './GmailPassword';
import { levelOf, productOfApp } from './googleAccess';
import {
  AddGoogleAccount,
  GoogleAccountCard,
  GoogleAccountsSection,
  useGoogleRefresh,
  useGoogleStatus,
} from './GoogleAccounts';
import { googleApi } from './googleApi';
import styles from './Integrations.module.css';
import { useAssistantName } from './queries';

export { APP_PASSWORDS_URL, GmailPassword };

/**
 * Connecting Gmail, Google Calendar or Google Drive (ADR 0048), from the tile
 * that was pressed. Accounts already connected come first: one tap gives one
 * of them this app too. Otherwise a new account, in three short steps: what
 * it should help with, the simplest way to connect for that, and connecting.
 */
export function GoogleAppConnect({
  entry,
  onClose,
  inChat,
  onAskAgain,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  inChat?: boolean;
  onAskAgain?: () => void;
}) {
  const app = entry.id as GoogleAppId;
  const product = productOfApp(app);
  const assistant = useAssistantName();
  const navigate = useNavigate();
  const refresh = useGoogleRefresh();
  const status = useGoogleStatus();
  const accounts = status.data?.accounts ?? [];
  const [addingManually, setAdding] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [connected, setConnected] = useState(false);

  const done = () => {
    setConnected(true);
    // Shown in Apps again if it was disconnected before.
    void googleApi
      .useApp(app)
      .catch(() => undefined)
      .then(refresh);
  };

  const phase: HandshakePhase = connected ? 'connected' : 'idle';
  const tryIt = (prompt: string) => {
    onClose();
    void navigate('/', { state: { draft: prompt } });
  };
  const adding = addingManually || committed;
  const choosing = !adding && accounts.length > 0;
  // Once the add flow starts (no connected accounts, status loaded), stay in it until done.
  // Otherwise a newly-connected account unmounts the view mid-way through and the heading
  // never flips to “connected”.
  if (status.data && !accounts.length && !committed && !connected) setCommitted(true);

  return (
    <>
      <Dialog.Header className={styles.connectHeader}>
        <IntegrationHandshake
          name={entry.name}
          brand={entry.id}
          color={entry.color}
          phase={phase}
        />
        <Dialog.Title className={styles.connectTitle}>
          {connected ? `${entry.name} is connected` : `Connect ${entry.name}`}
        </Dialog.Title>
        <Text tone="muted" align="center" className={styles.connectLead}>
          {connected
            ? `${assistant} can use ${entry.name} in every chat now, with every model. It asks you before every change.`
            : choosing
              ? `Use an account you’ve connected, or add another.`
              : entry.description}
        </Text>
      </Dialog.Header>
      {!(inChat && connected) && (
        <Dialog.Body>
          {connected ? (
            <Stack gap={5}>
              {app === 'gmail' && <TalkByEmail />}
              {/* Routines that start from it, offered once (ADR 0056). Not in a chat: you're mid-way through something. */}
              <WhenStarters app={app} />
              <TryIt entry={entry} onPick={tryIt} />
            </Stack>
          ) : choosing ? (
            <Stack gap={4}>
              <ul className={styles.accounts} aria-label="Your Google accounts">
                {accounts.map((account) => (
                  <li key={account.id}>
                    <GoogleAccountCard
                      account={account}
                      focus={product}
                      only={[product]}
                      onRaised={(raised) => raised === product && done()}
                      onUseGoogle={() => setAdding(true)}
                    />
                  </li>
                ))}
              </ul>
              {accounts.some((a) => levelOf(a, product) !== 'off') && (
                <Button className={styles.fit} onClick={done}>
                  Done
                </Button>
              )}
              <Button
                variant="ghost"
                leadingIcon={<Plus />}
                className={styles.fit}
                onClick={() => setAdding(true)}
              >
                Add another Google account
              </Button>
            </Stack>
          ) : (
            <AddGoogleAccount
              start={{ [product]: 'read' }}
              {...(accounts.length && {
                onCancel: () => {
                  setAdding(false);
                  setCommitted(false);
                },
              })}
              onDone={done}
            />
          )}
        </Dialog.Body>
      )}
      {connected && (
        <Dialog.Footer className={styles.connectFooter}>
          {inChat ? (
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
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                  void navigate(`/apps/${app}`);
                }}
              >
                Choose what it can do
              </Button>
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </Dialog.Footer>
      )}
    </>
  );
}

/**
 * Once Gmail is connected with an app password, talking to the assistant by
 * email can use the same one (ADR 0052): offered in one tap, never done by
 * itself, and only the address is ever shown.
 */
function TalkByEmail() {
  const assistant = useAssistantName();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: channels } = useChannels();
  const client = useQueryClient();
  const offer = useQuery({
    queryKey: ['channels', 'gmail-offer'],
    queryFn: channelsApi.gmailOffer,
  });
  const [made, setMade] = useState<Channel>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const address = offer.data?.address;
  if (!made && (!address || channels?.channels.some((c) => c.kind === 'email'))) return dialog;
  const turnOn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        const channel = await channelsApi.fromGmail();
        putChannel(client, channel);
        setMade(channel);
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {dialog}
      {made ? (
        <Callout
          tone="success"
          icon={<MessageCircle />}
          title="You can talk to it by email now"
          live="polite"
        >
          Write to {whoOf(made)} from any mail app, and {assistant} answers there.
        </Callout>
      ) : (
        <Callout
          tone="info"
          icon={<MessageCircle />}
          title={`Talk to ${assistant} by email too?`}
          action={
            <Button size="sm" loading={busy} onClick={() => void turnOn()}>
              Turn it on
            </Button>
          }
        >
          It uses the app password Gmail already has: write to {address?.replace('@', '+conch@')}{' '}
          from any mail app, and the answer comes back. Only you can reach it.
          {error && <Text tone="danger">{error}</Text>}
        </Callout>
      )}
    </>
  );
}

/**
 * The accounts part of a Google app's page: every connected account, what
 * each may do here and in the other Google apps, and adding another. When
 * the app's health changes (a check, a refused password), the accounts are
 * read again.
 */
export function GoogleAppConnection({ integration }: { integration: Integration }) {
  const status = useGoogleStatus();
  const { refetch } = status;
  const healthKey = `${integration.health.state}:${integration.health.checkedAt ?? ''}`;
  useEffect(() => {
    void refetch();
  }, [healthKey, refetch]);
  return <GoogleAccountsSection app={integration.id as GoogleAppId} />;
}

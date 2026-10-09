/**
 * Connected Google accounts (ADR 0048): as many as you like, each signed in
 * its own way (an app password for Gmail, or Google's own sign-in), and each
 * with its own level in Gmail, Calendar and Drive — Off, Read, or Read &
 * write. Lowering is a tap. Raising within what Google allowed is a tap
 * (and a "confirm it's you"); past it, Google is asked once, right there.
 */
import {
  capabilitiesFor,
  levelRank,
  type GoogleAccount,
  type GoogleAppId,
  type GoogleLevel,
  type GoogleProduct,
} from '@conch/protocol';
import {
  AccessLevels,
  AccountAccessCard,
  AlertDialog,
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  GuideSteps,
  Heading,
  RadioGroup,
  Stack,
  Text,
  toast,
  type AccessLevel,
  META_SEP,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCw, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { stepState } from '../channels/ConnectChannel';
import { APP_PASSWORDS_URL, GmailPassword } from './GmailPassword';
import {
  capabilitiesWith,
  levelOf,
  methodLine,
  needsConsent,
  PRODUCTS,
  productInfo,
  reachable,
  serviceRows,
  simplest,
  wantedAccess,
  type Wanted,
} from './googleAccess';
import { googleApi } from './googleApi';
import { GoogleConnect } from './GoogleConnect';
import styles from './Integrations.module.css';
import { integrationKeys, useAssistantName } from './queries';

/** Everything Google-shaped is read again: the accounts, and the apps they make. */
export function useGoogleRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: integrationKeys.all });
    void client.invalidateQueries({ queryKey: ['google'] });
  };
}

export const useGoogleStatus = () => useQuery({ queryKey: ['google'], queryFn: googleApi.status });

const describeLevel = (level: GoogleLevel) =>
  level === 'write' ? 'read & write' : level === 'read' ? 'read only' : 'off';

/**
 * One account and what it may do. `only` narrows it to one product (the
 * connect dialog of one app). `onRaised` is told when a product went up, so
 * that dialog knows it's done.
 */
export function GoogleAccountCard({
  account,
  focus,
  only,
  onRaised,
  onUseGoogle,
  onUsePassword,
}: {
  account: GoogleAccount;
  focus?: GoogleProduct;
  only?: GoogleProduct[];
  onRaised?: (product: GoogleProduct) => void;
  /** An app-password account wants Calendar or Drive: add it with Google sign-in instead. */
  onUseGoogle?: (account: GoogleAccount, product: GoogleProduct) => void;
  /** A Google sign-in account would rather send through an app password. */
  onUsePassword?: (account: GoogleAccount) => void;
}) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const refresh = useGoogleRefresh();
  const [busy, setBusy] = useState<GoogleProduct>();
  const [consent, setConsent] = useState<{ product: GoogleProduct; level: GoogleLevel }>();
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();

  const change = async (product: GoogleProduct, level: GoogleLevel) => {
    setError(undefined);
    if (level === levelOf(account, product)) return;
    if (!reachable(account, product)) return onUseGoogle?.(account, product);
    if (needsConsent(account, product, level)) return setConsent({ product, level });
    setConsent(undefined);
    setBusy(product);
    try {
      const done = await guard(() => googleApi.setAccess(account.id, { product, level }));
      if (done) {
        refresh();
        if (levelRank(level) > levelRank(levelOf(account, product))) onRaised?.(product);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'consent') setConsent({ product, level });
      else setError(e instanceof ApiError ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(undefined);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(undefined);
    try {
      await googleApi.check(account.id);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Google couldn’t be reached. Try again.');
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    setError(undefined);
    try {
      if (await guard(() => googleApi.disconnect(account.id))) {
        refresh();
        toast.success(`${account.email} is removed`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    }
  };

  const password = account.via === 'app-password';
  const fix =
    account.state === 'needs-auth' ? (
      password ? (
        <GmailPassword accountId={account.id} address={account.email} onConnected={refresh} />
      ) : (
        <GoogleConnect
          accountId={account.id}
          capabilities={
            account.capabilities.length
              ? account.capabilities
              : capabilitiesFor({ ...account.access })
          }
          label="Sign in again"
          lead="Google asks you to confirm, and everything carries on as before."
          onReady={refresh}
        />
      )
    ) : account.state === 'unavailable' ? (
      <Button
        size="sm"
        variant="surface"
        leadingIcon={<RotateCw />}
        className={styles.fit}
        loading={checking}
        onClick={() => void check()}
      >
        Try again now
      </Button>
    ) : undefined;

  const consentInfo = consent && productInfo(consent.product);
  return (
    <>
      {dialog}
      <AccountAccessCard
        email={account.email}
        name={account.name}
        method={methodLine(account)}
        state={checking ? 'checking' : account.state}
        message={
          account.state === 'unavailable'
            ? `${account.message ?? 'Google couldn’t be reached.'} Conch keeps trying by itself.`
            : account.message
        }
        fix={fix}
        services={serviceRows(account, {
          focus,
          ...(only && { only }),
          ...(busy && { busy }),
          ...(onUseGoogle && { onSwitch: (product) => onUseGoogle(account, product) }),
        })}
        onLevelChange={(product, level) => void change(product as GoogleProduct, level)}
        panel={
          consent && consentInfo ? (
            <>
              <Text size="sm" weight="medium">
                Allow {consentInfo.name} {describeLevel(consent.level)} for {account.email}
              </Text>
              <Text size="sm" tone="muted">
                Google asks you once, in its own window, and you come straight back. Nothing else
                about this account changes.
              </Text>
              <GoogleConnect
                accountId={account.id}
                capabilities={capabilitiesWith(account, consent.product, consent.level)}
                label="Allow on Google"
                lead="Choose this same account when Google asks."
                onReady={() => {
                  const product = consent.product;
                  setConsent(undefined);
                  refresh();
                  onRaised?.(product);
                }}
                onCancel={() => setConsent(undefined)}
              />
            </>
          ) : error ? (
            <Callout tone="danger" live="polite">
              {error}
            </Callout>
          ) : undefined
        }
        actions={
          <>
            {account.state === 'ready' && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<RotateCw />}
                loading={checking}
                onClick={() => void check()}
              >
                Check now
              </Button>
            )}
            {password && onUseGoogle && (
              <Button size="sm" variant="ghost" onClick={() => onUseGoogle(account, 'gmail')}>
                Switch to Google sign-in
              </Button>
            )}
            {!password && onUsePassword && (
              <Button size="sm" variant="ghost" onClick={() => onUsePassword(account)}>
                Use an app password instead
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              leadingIcon={<Trash2 />}
              onClick={() => setConfirm(true)}
            >
              Remove
            </Button>
          </>
        }
      />
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger" icon={<Trash2 />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove {account.email}?</AlertDialog.Title>
            <AlertDialog.Description>
              {password ? (
                <>
                  Gmail stops using it, and Conch forgets its app password. To stop the password
                  working at Google too, remove it on{' '}
                  <a href={APP_PASSWORDS_URL} target="_blank" rel="noopener noreferrer">
                    Google’s app passwords page
                  </a>
                  .
                </>
              ) : (
                'Gmail, Calendar and Drive stop using it. Conch asks Google to take back its access, then forgets the sign-in.'
              )}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => void remove()}>
              Remove
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}

/**
 * Adding an account, in three short steps: what it should help with, the
 * simplest way to connect for that (with the trade-off in one line), and
 * connecting. Nothing is kept until Google or Gmail said yes.
 */
export function AddGoogleAccount({
  start,
  email,
  prefer,
  onDone,
  onCancel,
}: {
  /** What's chosen to begin with: the app whose tile was pressed, at Read. */
  start: Wanted;
  /** The address, when it's known (moving an app-password account to Google sign-in). */
  email?: string;
  /** The way to connect someone asked for ("Switch to Google sign-in"). */
  prefer?: 'password' | 'google';
  onDone: (accountId: string) => void;
  onCancel?: () => void;
}) {
  const assistant = useAssistantName();
  const status = useGoogleStatus();
  const [wanted, setWanted] = useState<Wanted>(start);
  const [at, setAt] = useState<0 | 1 | 2>(() => {
    // A reload while Google is signing in picks up at the connect step, so the saved flow
    // in sessionStorage keeps polling. The GoogleConnect itself owns that recovery; here we
    // only make sure its view is mounted.
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i) ?? '';
        if (key.startsWith('conch-google-flow:new:')) return 2;
      }
    } catch {
      /* Private browsing. */
    }
    return 0;
  });
  const [picked, setPicked] = useState<'password' | 'google' | undefined>(prefer);
  const configured = status.data?.configured ?? false;
  const chosen = wantedAccess(wanted);
  const products = Object.keys(chosen) as GoogleProduct[];
  const gmailOnly = products.length > 0 && products.every((p) => p === 'gmail');
  const recommended = simplest(wanted, configured);
  const method = gmailOnly ? (picked ?? recommended) : 'google';
  const summary = products
    .map((p) => `${productInfo(p).name}: ${describeLevel(chosen[p] ?? 'off')}`)
    .join(META_SEP);

  return (
    <Stack gap={4}>
      <GuideSteps label="Add a Google account">
        <GuideSteps.Step
          number={1}
          title={`What should ${assistant} help with?`}
          state={stepState(0, at)}
          summary={at > 0 ? summary : undefined}
          onEdit={at > 0 ? () => setAt(0) : undefined}
          editLabel="Change"
        >
          <Stack gap={3}>
            <Text size="sm" tone="muted">
              Read lets it look things up. Read & write also lets it make changes — and it asks you
              before every one. You can change this any time.
            </Text>
            <AccessLevels
              label="What it may do with the new account"
              services={PRODUCTS.map((p) => ({
                id: p.id,
                name: p.name,
                brand: p.app,
                color: p.color,
                level: wanted[p.id] ?? 'off',
                describe: p.describe,
              }))}
              onChange={(id, level: AccessLevel) =>
                setWanted((w) => ({ ...w, [id as GoogleProduct]: level }))
              }
            />
            <Stack direction="row" gap={2}>
              <Button disabled={!products.length} onClick={() => setAt(1)}>
                Next
              </Button>
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </Stack>
          </Stack>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="How to connect"
          state={stepState(1, at)}
          summary={at > 1 ? (method === 'password' ? 'App password' : 'Google sign-in') : undefined}
          onEdit={at > 1 ? () => setAt(1) : undefined}
          editLabel="Change"
        >
          <Stack gap={3}>
            {gmailOnly ? (
              <RadioGroup
                variant="card"
                aria-label="How to connect"
                value={method}
                onValueChange={(v) => setPicked(v as 'password' | 'google')}
              >
                <RadioGroup.Item
                  value="password"
                  icon={<UserRound />}
                  label={
                    <span className={styles.choiceLabel}>
                      App password
                      {recommended === 'password' && (
                        <Badge size="sm" tone="accent">
                          Simplest
                        </Badge>
                      )}
                    </span>
                  }
                  description="About two minutes: make one at Google and paste it. Gmail only, and it can’t reach Calendar or Drive."
                />
                <RadioGroup.Item
                  value="google"
                  icon={<GoogleMark />}
                  label={
                    <span className={styles.choiceLabel}>
                      Google sign-in
                      {recommended === 'google' && (
                        <Badge size="sm" tone="accent">
                          Simplest
                        </Badge>
                      )}
                    </span>
                  }
                  description={
                    configured
                      ? 'One press: your Google app is already set up. Works for Calendar and Drive too.'
                      : 'Gmail, Calendar and Drive. Needs your own free Google Cloud app, once — about ten minutes, every step shown.'
                  }
                />
              </RadioGroup>
            ) : (
              <Callout tone="info" title="Google sign-in">
                {configured
                  ? 'Your Google app is already set up, so this is one press.'
                  : 'Calendar and Drive only open to Google’s own sign-in. It takes a free Google Cloud app of your own, once — about ten minutes, with every step shown.'}
              </Callout>
            )}
            <Button className={styles.fit} onClick={() => setAt(2)}>
              Next
            </Button>
          </Stack>
        </GuideSteps.Step>
      </GuideSteps>
      {at === 2 &&
        (method === 'password' ? (
          <GmailPassword
            address={email}
            access={chosen.gmail}
            onConnected={(id) => id && onDone(id)}
          />
        ) : (
          <GoogleConnect
            capabilities={capabilitiesFor(chosen)}
            onReady={onDone}
            {...(email && { lead: `Choose ${email} when Google asks.` })}
          />
        ))}
    </Stack>
  );
}

/** Google's "G", for the sign-in choice. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.74 2.99-4.3 2.99-7.33ZM12 22c2.7 0 4.96-.9 6.61-2.43l-3.23-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.08v2.58A9.99 9.99 0 0 0 12 22Zm-5.59-8.09a6 6 0 0 1 0-3.82V7.5H3.08a10 10 0 0 0 0 8.99l3.33-2.58ZM12 5.96c1.47 0 2.79.5 3.83 1.5l2.86-2.86A9.6 9.6 0 0 0 12 2a9.99 9.99 0 0 0-8.92 5.5l3.33 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
      />
    </svg>
  );
}

/**
 * The accounts section of a Google app's page: every connected account,
 * what each may do, and adding another. The same list on all three pages,
 * with this app's row marked.
 */
export function GoogleAccountsSection({ app }: { app: GoogleAppId }) {
  const status = useGoogleStatus();
  const refresh = useGoogleRefresh();
  const [adding, setAdding] = useState<{
    start: Wanted;
    email?: string;
    prefer?: 'google';
  }>();
  /** A Google sign-in's address, to connect Gmail with an app password instead. */
  const [password, setPassword] = useState<string>();
  const focus = PRODUCTS.find((p) => p.app === app)?.id;
  const accounts = [...(status.data?.accounts ?? [])].sort((a, b) =>
    focus ? levelRank(levelOf(b, focus)) - levelRank(levelOf(a, focus)) : 0,
  );
  const add = (start: Wanted = focus ? { [focus]: 'read' } : {}, email?: string) =>
    setAdding({ start, ...(email && { email, prefer: 'google' as const }) });
  return (
    <section className={styles.section} aria-labelledby="google-accounts">
      <div className={styles.sectionHead}>
        <Stack gap={0.5}>
          <Heading level={2} id="google-accounts" size="md" tabIndex={-1}>
            Google accounts
          </Heading>
          <Text size="sm" tone="muted">
            Add as many as you like. Each can be off, read only, or read & write in Gmail, Calendar
            and Drive. Read & write in Gmail can send, and shows you each email first.
          </Text>
        </Stack>
        <Button size="sm" variant="surface" leadingIcon={<Plus />} onClick={() => add()}>
          Add an account
        </Button>
      </div>
      {status.isPending ? (
        <Text tone="muted">Looking at your Google accounts…</Text>
      ) : accounts.length ? (
        <ul className={styles.accounts} aria-label="Google accounts">
          {accounts.map((account) => (
            <li key={account.id}>
              <GoogleAccountCard
                account={account}
                {...(focus && { focus })}
                onUseGoogle={(a, product) =>
                  add(
                    product === 'gmail'
                      ? { gmail: a.access?.gmail ?? 'write' }
                      : { ...(a.access?.gmail && { gmail: a.access.gmail }), [product]: 'read' },
                    a.email,
                  )
                }
                onUsePassword={(a) => setPassword(a.email)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          headingLevel={3}
          title="No Google account yet"
          description="Add one, and choose what it may do."
          actions={
            <Button leadingIcon={<Plus />} onClick={() => add()}>
              Add an account
            </Button>
          }
        />
      )}
      <Dialog.Root open={!!password} onOpenChange={(open) => !open && setPassword(undefined)}>
        <Dialog.Content size="md">
          <Dialog.Header>
            <Dialog.Title>Use an app password for Gmail</Dialog.Title>
            <Dialog.Description>
              Gmail then reads and sends with the app password, and shows you each email first.
              Calendar and Drive keep using Google sign-in.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            {password && (
              <GmailPassword
                address={password}
                access="write"
                onConnected={() => {
                  setPassword(undefined);
                  refresh();
                  toast.success('Gmail uses the app password now');
                }}
              />
            )}
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={!!adding} onOpenChange={(open) => !open && setAdding(undefined)}>
        <Dialog.Content size="md" aria-describedby={undefined}>
          <Dialog.Header>
            <Dialog.Title>Add a Google account</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            {adding && (
              <AddGoogleAccount
                start={adding.start}
                {...(adding.email && { email: adding.email })}
                {...(adding.prefer && { prefer: adding.prefer })}
                onCancel={() => setAdding(undefined)}
                onDone={() => {
                  setAdding(undefined);
                  refresh();
                  toast.success('Google account added');
                }}
              />
            )}
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}

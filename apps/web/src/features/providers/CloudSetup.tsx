import type { CloudKind, CloudPicker, CloudProviderId, Provider } from '@conch/protocol';
import {
  Button,
  Callout,
  CloudAccountPicker,
  Field,
  SegmentedControl,
  Select,
  SignInCode,
  Skeleton,
  Spinner,
  Stack,
  Text,
} from '@conch/nacre';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { refreshCapabilities, useModels } from '../../api/queries';
import { api } from '../../api/client';
import { useLiveStore } from '../../live/store';
import { GetIt } from '../setup/GetIt';
import { providersApi } from './api';
import styles from './Providers.module.css';
import { errorText, putProvider } from './queries';

/** The words each cloud uses (ADR 0109). */
const WORDS: Record<
  CloudKind,
  { list: string; signIn: string; again: string; region: string; empty: string }
> = {
  aws: {
    list: 'AWS accounts on this computer',
    signIn: 'Sign in to AWS',
    again: 'Sign in to AWS again',
    region: 'Region',
    empty: 'There’s no AWS sign-in on this computer yet.',
  },
  gcp: {
    list: 'Your Google Cloud projects',
    signIn: 'Sign in to Google Cloud',
    again: 'Sign in to Google Cloud again',
    region: 'Where it runs',
    empty: 'No Google Cloud projects found yet.',
  },
  azure: {
    list: 'Your Azure OpenAI resources',
    signIn: 'Sign in to Azure',
    again: 'Sign in to Azure again',
    region: 'Region',
    empty: 'No Azure OpenAI resources found yet.',
  },
};

export const cloudKeys = {
  picker: (id: CloudProviderId, via?: string) => ['clouds', id, via ?? ''] as const,
};

/** A cloud sign-in under way: the page and code it gave, until it's done. */
function SignInProgress({ cloud }: { cloud: CloudKind }) {
  const login = useLiveStore((s) => s.login);
  if (!login || ['done', 'failed', 'cancelled'].includes(login.phase)) return null;
  const words = WORDS[cloud];
  return (
    <Stack gap={3} aria-live="polite">
      {login.code && login.url ? (
        <SignInCode
          code={login.code}
          url={login.url}
          title={`${words.signIn} with this code`}
          waiting="Conch carries on by itself when you’re done."
        />
      ) : login.url ? (
        <Stack gap={2}>
          <Text tone="muted" size="sm">
            {login.message ?? 'Finish on the page that opened. This updates on its own.'}
          </Text>
          <div>
            <Button asChild variant="surface" size="sm">
              <a href={login.url} target="_blank" rel="noreferrer">
                Open the sign-in page <ExternalLink aria-hidden className={styles.linkIcon} />
              </a>
            </Button>
          </div>
        </Stack>
      ) : (
        <div className={styles.waiting}>
          <Spinner size="xs" label={null} />
          <Text as="span" size="sm" tone="muted">
            {login.phase === 'verifying' ? 'Checking your sign-in…' : 'Starting the sign-in…'}
          </Text>
        </div>
      )}
      <div>
        <Button variant="ghost" size="sm" onClick={() => void api.cancelLogin()}>
          Cancel
        </Button>
      </div>
    </Stack>
  );
}

/**
 * Choosing a cloud account, on a provider's page (ADR 0109): the accounts
 * Conch found here, one press each; the region; signing in again where a
 * sign-in ended; and the cloud's own program, installed by Conch when it's
 * missing. `cloudId` is the provider (or `claude-code`, with `via`).
 */
export function CloudAccounts({
  provider,
  cloudId,
  via,
  showModels = true,
}: {
  provider: Provider;
  cloudId: CloudProviderId;
  via?: 'bedrock' | 'vertex';
  /** List the models it found (Claude Code lists its own). */
  showModels?: boolean;
}) {
  const client = useQueryClient();
  const login = useLiveStore((s) => s.login);
  const setLogin = useLiveStore((s) => s.setLogin);
  const signingIn = Boolean(login && !['done', 'failed', 'cancelled'].includes(login.phase));
  const picker = useQuery({
    queryKey: cloudKeys.picker(cloudId, via),
    queryFn: () => providersApi.cloud(cloudId, via),
    // While the cloud's program is missing or nobody's signed in, keep looking.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (!data.tool.present || data.signedIn === false || !data.accounts.length)
        ? 4000
        : false;
    },
  });
  const [region, setRegion] = useState<string>();
  const [error, setError] = useState<string>();
  const data = picker.data;
  const cloud = data?.cloud ?? 'aws';
  const words = WORDS[cloud];
  const chosen = data?.chosen?.account;

  const check = async () => {
    const next = await providersApi.check(provider.id).catch(() => undefined);
    if (next) putProvider(client, next);
    void refreshCapabilities(client);
  };
  const choose = useMutation({
    mutationFn: async (input: { account: string; region?: string }) => {
      const body = { account: input.account, ...(input.region && { region: input.region }) };
      const next: CloudPicker =
        cloudId === 'claude-code'
          ? await providersApi.claudeCloud({ via: via ?? 'bedrock', ...body })
          : await providersApi.chooseCloud(cloudId, body);
      client.setQueryData(cloudKeys.picker(cloudId, via), next);
      await check();
      return next;
    },
    onMutate: () => setError(undefined),
    onError: (e) => setError(errorText(e, 'That account didn’t work.')),
  });

  // Signed in: look again, and carry on.
  useEffect(
    () =>
      useLiveStore.subscribe((now, before) => {
        if (now.login?.phase === 'done' && before.login?.phase !== 'done') {
          void picker.refetch();
          void check();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider.id],
  );

  const signIn = async (account?: string) => {
    setError(undefined);
    try {
      if (account && account !== chosen) await choose.mutateAsync({ account });
      setLogin({ loginId: 'local', phase: 'starting' });
      await providersApi.login(provider.id, 'subscription');
    } catch (e) {
      setLogin({
        loginId: 'local',
        phase: 'failed',
        message: errorText(e, 'Signing in didn’t start.'),
      });
    }
  };

  const models = useModels(showModels && provider.status.state === 'ready');
  const listed =
    models.data?.providers.find((p) => p.engine === provider.id)?.models.map((m) => m.label) ?? [];

  if (picker.isPending)
    return (
      <Stack gap={2}>
        <Skeleton shape="block" height="4.5rem" />
        <Skeleton shape="block" height="4.5rem" />
      </Stack>
    );
  if (!data)
    return (
      <Callout tone="warning" title="Conch couldn’t look for your cloud sign-ins">
        {errorText(picker.error, 'Try again in a moment.')}
      </Callout>
    );

  const ready = provider.status.state === 'ready';
  const busy = choose.isPending || provider.status.state === 'checking';
  const problem = !ready && chosen && !busy ? provider.status.message : undefined;
  // What the account turned out to be, without the provider's own name in front.
  const said = ready
    ? provider.status.auth?.description.replace(
        /^(Amazon Bedrock|Google Vertex AI|Azure OpenAI) · /,
        '',
      )
    : undefined;
  // Google and Azure sign in once for every project; AWS signs in per profile.
  const needsSignIn = data.signedIn === false;
  const needsTool = !data.tool.present && (cloud !== 'aws' || !data.accounts.length);
  const regionNow = region ?? data.chosen?.region ?? data.region;

  return (
    <Stack gap={4}>
      {needsTool && (
        <GetIt
          needId={data.tool.need}
          name={data.tool.name}
          lead={`Conch signs in to ${data.name.replace(/^Claude Code on /, '')} with the ${data.tool.name}, the cloud’s own program. Conch can install it for you.`}
        />
      )}
      {!needsTool && needsSignIn && !signingIn && (
        <Stack gap={2} align="start">
          <Text tone="muted">{data.message}</Text>
          <Button size="lg" onClick={() => void signIn()}>
            {words.signIn}
          </Button>
        </Stack>
      )}
      <SignInProgress cloud={cloud} />
      {login?.phase === 'failed' && login.message && (
        <Callout tone="warning" title="Signing in didn’t finish">
          {login.message}
        </Callout>
      )}
      {!needsSignIn && (
        <CloudAccountPicker
          label={words.list}
          accounts={data.accounts}
          {...(chosen && { chosen })}
          {...(choose.isPending && choose.variables && { pending: choose.variables.account })}
          {...(said && { ready: said })}
          models={listed}
          {...((error ?? problem) && { problem: error ?? problem })}
          {...(signingIn && chosen && { signingIn: chosen })}
          signInLabel={words.again}
          onChoose={(account) =>
            choose.mutate({ account, ...(regionNow && { region: regionNow }) })
          }
          {...(cloud === 'aws'
            ? { onSignIn: (account: string) => void signIn(account) }
            : problem && /sign in/i.test(problem)
              ? { onSignIn: () => void signIn() }
              : {})}
          empty={data.message ?? words.empty}
        />
      )}
      {data.regions.length > 1 && (
        <Field>
          <Field.Label>{words.region}</Field.Label>
          <Select
            value={regionNow}
            onValueChange={(next) => {
              setRegion(next);
              if (chosen) choose.mutate({ account: chosen, region: next });
            }}
          >
            {data.regions.map((r) => (
              <Select.Item key={r.id} value={r.id}>
                {r.label}
              </Select.Item>
            ))}
          </Select>
          <Field.Description>
            {cloud === 'aws'
              ? 'Only the Claude models your account can use in this region are offered.'
              : 'Global answers fastest and costs least. The US and EU keep your data there.'}
          </Field.Description>
        </Field>
      )}
    </Stack>
  );
}

/** A cloud provider's page: its accounts, and anything else a way in needs (a Bedrock key). */
export function CloudSetup({ provider, children }: { provider: Provider; children?: ReactNode }) {
  const id = provider.id as Exclude<CloudProviderId, 'claude-code'>;
  return (
    <Stack gap={5}>
      <CloudAccounts provider={provider} cloudId={id} />
      {children}
    </Stack>
  );
}

/**
 * Where Claude Code runs (ADR 0109): Anthropic's own sign-in, or Claude Code
 * on Amazon Bedrock or Google Vertex AI with an account found here. Claude
 * Code reads the switch from its environment, so nothing of its own changes.
 */
export function ClaudeRunsOn({ provider }: { provider: Provider }) {
  const client = useQueryClient();
  const current = useQuery({
    queryKey: cloudKeys.picker('claude-code'),
    queryFn: () => providersApi.cloud('claude-code'),
  });
  const [shown, setShown] = useState<'anthropic' | 'bedrock' | 'vertex'>();
  const via = current.data?.chosen?.via;
  const value = shown ?? via ?? 'anthropic';
  const back = useMutation({
    mutationFn: () => providersApi.claudeCloud({ via: 'anthropic' }),
    onSuccess: async (next) => {
      client.setQueryData(cloudKeys.picker('claude-code'), next);
      const fresh = await providersApi.check(provider.id).catch(() => undefined);
      if (fresh) putProvider(client, fresh);
      void refreshCapabilities(client);
    },
  });
  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <Text weight="medium">Where Claude Code runs</Text>
        <Text tone="muted" size="sm">
          On your Claude plan, or on your company’s Amazon Bedrock or Google Vertex AI, billed to
          that account.
        </Text>
      </Stack>
      <SegmentedControl
        value={value}
        aria-label="Where Claude Code runs"
        onValueChange={(next) => {
          const where = next as 'anthropic' | 'bedrock' | 'vertex';
          setShown(where);
          if (where === 'anthropic' && via) back.mutate();
        }}
      >
        <SegmentedControl.Item value="anthropic">Claude plan</SegmentedControl.Item>
        <SegmentedControl.Item value="bedrock">Amazon Bedrock</SegmentedControl.Item>
        <SegmentedControl.Item value="vertex">Google Vertex AI</SegmentedControl.Item>
      </SegmentedControl>
      {value !== 'anthropic' && (
        <CloudAccounts provider={provider} cloudId="claude-code" via={value} showModels={false} />
      )}
    </Stack>
  );
}

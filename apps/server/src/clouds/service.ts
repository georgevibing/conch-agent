/**
 * Your company's cloud, found and chosen in one place (ADR 0109). The cloud
 * providers (Amazon Bedrock, Google Vertex AI, Azure OpenAI) and Claude Code
 * on Bedrock or Vertex all ask this service which account to use, for keys
 * or a token, and how to sign in again.
 *
 * - **Found, not typed.** Accounts come from what's on this computer: AWS
 *   profiles, Google's application default credentials and projects, the
 *   Azure CLI's subscriptions and the resources in them.
 * - **Chosen by a person.** Nothing is used until someone presses an account.
 *   A provider with nothing chosen isn't ready, so a cloud bill never starts
 *   by itself.
 * - **Read-only.** Conch never writes the clouds' own files and never changes
 *   anything in a cloud account. Only names are kept, in settings.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import type {
  ClaudeCloudBody,
  ChooseCloudBody,
  CloudChoice,
  CloudPicker,
  CloudProviderId,
  Found,
  LoginState,
} from '@conch/protocol';

import type { FetchLike } from '../engines/api/types';
import type { LoginHandle } from '../engines/types';
import type { SettingsStore } from '../settings/store';
import { awsAccounts, AwsKeys, ENV_ACCOUNT, type AwsDeps } from './aws';
import { AzureCloud, type AzureResource } from './azure';
import { CloudError } from './errors';
import { systemExec, type CloudExec } from './exec';
import { activeProject, adc, GcpCloud, PROJECT_ID } from './gcp';
import { BEDROCK_REGIONS, pickRegion, VERTEX_REGIONS } from './models';

export interface CloudServiceDeps {
  settings: SettingsStore;
  exec?: CloudExec;
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetch?: FetchLike;
  now?: () => number;
  read?: (path: string) => Promise<string | undefined>;
  /** A provider's account changed: what it knew is stale. */
  onChange?: (provider: CloudProviderId) => void;
}

type Cloudy = 'bedrock' | 'vertex' | 'azure-openai';

/** A found account's id for the page: stable, and safe whatever the profile is called. */
const foundId = (provider: string, account: string) =>
  `cloud-${provider}-${createHash('sha1').update(account, 'utf8').digest('hex').slice(0, 16)}`;

const NAMES: Record<Cloudy, string> = {
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  'azure-openai': 'Azure OpenAI',
};

const TOOLS = {
  aws: { need: 'aws-cli', name: 'AWS CLI', program: 'aws' },
  gcp: { need: 'gcloud', name: 'Google Cloud CLI', program: 'gcloud' },
  azure: { need: 'azure-cli', name: 'Azure CLI', program: 'az' },
} as const;

/** Which cloud a provider (or Claude Code, by where it runs) is on. */
function cloudFor(provider: CloudProviderId, via?: 'bedrock' | 'vertex'): Cloudy {
  if (provider === 'claude-code') return via ?? 'bedrock';
  return provider;
}

export class CloudService {
  readonly exec: CloudExec;
  readonly aws: AwsKeys;
  readonly gcp: GcpCloud;
  readonly azure: AzureCloud;
  readonly #awsDeps: AwsDeps;

  constructor(private readonly deps: CloudServiceDeps) {
    this.exec = deps.exec ?? systemExec();
    const base = {
      exec: this.exec,
      env: deps.env ?? process.env,
      home: deps.home ?? homedir(),
      ...(deps.now && { now: deps.now }),
      ...(deps.read && { read: deps.read }),
    };
    this.#awsDeps = base;
    this.aws = new AwsKeys(base);
    this.gcp = new GcpCloud(base);
    this.azure = new AzureCloud({ ...base, ...(deps.fetch && { fetch: deps.fetch }) });
  }

  /** What a provider uses now, if anyone chose. */
  async choice(provider: CloudProviderId): Promise<CloudChoice | undefined> {
    const { clouds } = await this.deps.settings.get();
    return clouds?.[provider];
  }

  /** The page for one provider: the accounts here, the regions, and what's chosen. */
  async picker(provider: CloudProviderId, via?: 'bedrock' | 'vertex'): Promise<CloudPicker> {
    const chosen = await this.choice(provider);
    const cloud = cloudFor(provider, via ?? chosen?.via);
    const name = provider === 'claude-code' ? `Claude Code on ${NAMES[cloud]}` : NAMES[cloud];
    const mine =
      chosen && (provider !== 'claude-code' || chosen.via === cloud) ? chosen : undefined;
    if (cloud === 'bedrock') {
      const [accounts, present] = await Promise.all([
        awsAccounts(this.#awsDeps),
        this.exec.find('aws'),
      ]);
      const preferred = accounts.find((a) => a.isDefault) ?? accounts[0];
      return {
        provider,
        cloud: 'aws',
        name,
        tool: { ...TOOLS.aws, present: Boolean(present), outdated: false },
        accounts,
        regions: [...BEDROCK_REGIONS],
        region: pickRegion(
          BEDROCK_REGIONS,
          mine?.region,
          preferred?.region,
          this.#awsDeps.env.AWS_REGION,
          this.#awsDeps.env.AWS_DEFAULT_REGION,
        ),
        ...(mine && { chosen: mine }),
        ...(!accounts.length && {
          message: present
            ? 'There’s no AWS sign-in on this computer yet. Set one up with your company’s AWS start page, or add a Bedrock API key.'
            : 'There’s no AWS sign-in on this computer yet. Install the AWS CLI to sign in, or add a Bedrock API key.',
        }),
      };
    }
    if (cloud === 'vertex') {
      const [accounts, present, signedIn] = await Promise.all([
        this.gcp.projects(),
        this.exec.find('gcloud'),
        this.gcp.signedIn(),
      ]);
      return {
        provider,
        cloud: 'gcp',
        name,
        tool: { ...TOOLS.gcp, present: Boolean(present), outdated: false },
        signedIn,
        accounts,
        regions: [...VERTEX_REGIONS],
        region: pickRegion(VERTEX_REGIONS, mine?.region, 'global'),
        ...(mine && { chosen: mine }),
        ...(!signedIn && {
          message: 'Sign in to Google Cloud once, and your projects appear here.',
        }),
      };
    }
    const [present, signedIn] = await Promise.all([this.exec.find('az'), this.azure.signedIn()]);
    let resources: AzureResource[] = [];
    let message: string | undefined;
    if (signedIn)
      try {
        resources = await this.azure.resources();
        if (!resources.length)
          message =
            'Your Azure subscriptions have no Azure OpenAI or AI Foundry resource yet. Make one in the Azure portal, and it appears here.';
      } catch (error) {
        message =
          error instanceof Error ? error.message : 'Conch couldn’t read your Azure resources.';
      }
    else message = 'Sign in to Azure once, and your Azure OpenAI resources appear here.';
    return {
      provider,
      cloud: 'azure',
      name,
      tool: { ...TOOLS.azure, present: Boolean(present), outdated: false },
      signedIn,
      accounts: resources.map((r) => r.account),
      regions: [],
      ...(mine && { chosen: mine }),
      ...(message && { message }),
    };
  }

  /** Use an account for a provider. Only an account found here, in a region that exists. */
  async choose(provider: Cloudy, body: ChooseCloudBody): Promise<CloudPicker> {
    const choice = await this.#validate(provider, body);
    await this.deps.settings.setCloud(provider, choice);
    this.#forget();
    this.deps.onChange?.(provider);
    return this.picker(provider);
  }

  /** Where Claude Code runs: Anthropic's own sign-in, or a cloud account found here. */
  async claudeCode(body: ClaudeCloudBody): Promise<CloudPicker> {
    if (body.via === 'anthropic' || !body.account) {
      await this.deps.settings.setCloud('claude-code', undefined);
      this.deps.onChange?.('claude-code');
      return this.picker('claude-code', body.via === 'anthropic' ? undefined : body.via);
    }
    const choice = await this.#validate(body.via, {
      account: body.account,
      ...(body.region && { region: body.region }),
    });
    await this.deps.settings.setCloud('claude-code', { ...choice, via: body.via });
    this.#forget();
    this.deps.onChange?.('claude-code');
    return this.picker('claude-code', body.via);
  }

  async #validate(cloud: Cloudy, body: ChooseCloudBody): Promise<CloudChoice> {
    const chosenAt = this.deps.now?.() ?? Date.now();
    if (cloud === 'bedrock') {
      const accounts = await awsAccounts(this.#awsDeps);
      const account = accounts.find((a) => a.id === body.account);
      if (!account) throw new CloudError('not-chosen', 'That AWS account isn’t on this computer.');
      return {
        account: account.id,
        label: account.label,
        region: pickRegion(BEDROCK_REGIONS, body.region, account.region),
        chosenAt,
      };
    }
    if (cloud === 'vertex') {
      if (!PROJECT_ID.test(body.account))
        throw new CloudError('not-chosen', 'That isn’t a Google Cloud project id.');
      const label = (await this.gcp.projects()).find((p) => p.id === body.account)?.label;
      return {
        account: body.account,
        ...(label && { label }),
        region: pickRegion(VERTEX_REGIONS, body.region, 'global'),
        chosenAt,
      };
    }
    const resource = (await this.azure.resources()).find((r) => r.account.id === body.account);
    if (!resource)
      throw new CloudError('not-chosen', 'That Azure resource isn’t in your subscriptions.');
    return {
      account: resource.account.id,
      label: resource.account.label,
      endpoint: resource.endpoint,
      subscription: resource.subscription,
      ...(resource.tenant && { tenant: resource.tenant }),
      ...(resource.account.region && { region: resource.account.region }),
      chosenAt,
    };
  }

  #forget() {
    this.aws.forget();
    this.gcp.forget();
    this.azure.forget();
  }

  /**
   * Sign in again with the cloud's own program, for the account a provider
   * uses: `aws sso login`, `gcloud auth application-default login`, `az login`.
   */
  async signIn(
    provider: CloudProviderId,
    update: (state: LoginState) => void,
  ): Promise<LoginHandle> {
    const chosen = await this.choice(provider);
    const cloud = cloudFor(provider, chosen?.via);
    const done = (state: LoginState) => {
      if (state.phase === 'done') this.deps.onChange?.(provider);
      update(state);
    };
    if (cloud === 'bedrock') {
      const profile = chosen?.account;
      if (!profile || profile === ENV_ACCOUNT)
        throw new CloudError(
          'not-chosen',
          'Choose an AWS account first: only a single sign-on profile signs in again.',
        );
      return this.aws.signIn(profile, done);
    }
    if (cloud === 'vertex') return this.gcp.signIn(done);
    return this.azure.signIn(done);
  }

  /**
   * Things already here that would connect a cloud provider in one press: a
   * signed-in AWS profile, Google Cloud credentials with a project. Read from
   * files only, so drawing the Providers page stays cheap. Azure's resources
   * need its API, so Azure is offered on its own page.
   */
  async found(skip: ReadonlySet<string>): Promise<Found[]> {
    const out: Found[] = [];
    const clouds = (await this.deps.settings.get()).clouds ?? {};
    if (!skip.has('bedrock') && !clouds.bedrock) {
      const account = (await awsAccounts(this.#awsDeps).catch(() => [])).find(
        (a) => a.state === 'ready' && !a.broad,
      );
      if (account)
        out.push({
          id: foundId('bedrock', account.id),
          kind: 'cloud',
          provider: 'bedrock',
          name: 'Amazon Bedrock',
          detail: `Your AWS sign-in “${account.label}” · ${account.detail}`,
          brand: 'bedrock',
          color: '#232F3E',
        });
    }
    if (!skip.has('vertex') && !clouds.vertex) {
      const [credentials, project] = await Promise.all([
        adc(this.#awsDeps).catch(() => ({ present: false, project: undefined })),
        activeProject(this.#awsDeps).catch(() => undefined),
      ]);
      const id = project ?? credentials.project;
      if (credentials.present && id)
        out.push({
          id: foundId('vertex', id),
          kind: 'cloud',
          provider: 'vertex',
          name: 'Google Vertex AI',
          detail: `Your Google Cloud sign-in · project ${id}`,
          brand: 'vertex',
          color: '#4285F4',
        });
    }
    return out;
  }

  /** Use something `found` offered. Returns the provider it connected, or undefined if it isn't one. */
  async useFound(id: string): Promise<CloudProviderId | undefined> {
    if (!id.startsWith('cloud-')) return undefined;
    for (const found of await this.found(new Set())) {
      if (found.id !== id || (found.provider !== 'bedrock' && found.provider !== 'vertex'))
        continue;
      const account = await this.#foundAccount(found.provider, id);
      if (!account) break;
      await this.choose(found.provider, { account });
      return found.provider;
    }
    throw new CloudError('not-chosen', 'That sign-in isn’t on this computer any more.');
  }

  async #foundAccount(provider: 'bedrock' | 'vertex', id: string): Promise<string | undefined> {
    if (provider === 'bedrock')
      return (await awsAccounts(this.#awsDeps)).find((a) => foundId('bedrock', a.id) === id)?.id;
    const [credentials, project] = await Promise.all([
      adc(this.#awsDeps),
      activeProject(this.#awsDeps),
    ]);
    const account = project ?? credentials.project;
    return account && foundId('vertex', account) === id ? account : undefined;
  }

  /**
   * What Claude Code's environment gains when it runs on a cloud: the switches
   * Claude Code documents (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`),
   * the profile or project, and the region. Nothing secret: Claude Code signs
   * in with the same AWS or Google sign-in itself.
   */
  async claudeEnv(): Promise<Record<string, string>> {
    const choice = await this.choice('claude-code').catch(() => undefined);
    if (!choice?.via) return {};
    if (choice.via === 'bedrock')
      return {
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_REGION: choice.region ?? 'us-east-1',
        ...(choice.account !== ENV_ACCOUNT && { AWS_PROFILE: choice.account }),
      };
    return {
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: choice.account,
      CLOUD_ML_REGION: choice.region ?? 'global',
    };
  }

  /**
   * Whether Claude Code's cloud sign-in works now, before a turn finds out:
   * undefined when it does (or it runs on Anthropic's own sign-in), else why.
   */
  async claudeProblem(): Promise<{ error: CloudError; label: string } | undefined> {
    const choice = await this.choice('claude-code').catch(() => undefined);
    if (!choice?.via) return undefined;
    try {
      if (choice.via === 'bedrock') await this.aws.credentials(choice.account);
      else await this.gcp.token();
      return undefined;
    } catch (error) {
      return {
        error:
          error instanceof CloudError
            ? error
            : new CloudError('failed', 'Conch couldn’t check your cloud sign-in.'),
        label: choice.label ?? choice.account,
      };
    }
  }
}

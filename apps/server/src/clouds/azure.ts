/**
 * Azure, the way the Azure CLI already knows it (ADR 0109): the
 * subscriptions in `~/.azure/azureProfile.json`, tokens from `az account
 * get-access-token`, and — through Azure's own management API, read only —
 * the Azure OpenAI and Azure AI Foundry resources in them and their
 * deployments.
 *
 * Conch reads; it never creates, changes or deletes anything in Azure. A
 * token goes only to Microsoft's own hosts: the management API and a
 * resource address that Azure itself named and that ends in one of
 * Microsoft's domains (`azureEndpoint`).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CloudAccount, LoginState } from '@conch/protocol';
import { z } from 'zod';

import type { FetchLike } from '../engines/api/types';
import type { LoginHandle } from '../engines/types';
import { CloudError } from './errors';
import { clean, type CloudExec } from './exec';
import { signIn } from './signin';

export interface AzureDeps {
  exec: CloudExec;
  env: NodeJS.ProcessEnv;
  home: string;
  fetch?: FetchLike;
  now?: () => number;
  read?: (path: string) => Promise<string | undefined>;
}

const readText = (path: string) => readFile(path, 'utf8').catch(() => undefined);

const MANAGEMENT = 'https://management.azure.com';
const COGNITIVE = 'https://cognitiveservices.azure.com';
const API_VERSION = '2024-10-01';

const Profile = z.object({
  subscriptions: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        state: z.string().optional(),
        isDefault: z.boolean().optional(),
        tenantId: z.string().optional(),
      }),
    )
    .default([]),
});

export interface Subscription {
  id: string;
  name: string;
  tenant?: string;
  isDefault: boolean;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The subscriptions `az login` left on this computer, enabled ones only. */
export async function azureSubscriptions(deps: AzureDeps): Promise<Subscription[]> {
  const dir = deps.env.AZURE_CONFIG_DIR?.trim() || join(deps.home, '.azure');
  const text = await (deps.read ?? readText)(join(dir, 'azureProfile.json'));
  if (!text) return [];
  try {
    // The CLI writes it with a byte-order mark.
    const parsed = Profile.safeParse(JSON.parse(text.replace(/^\uFEFF/, '')));
    if (!parsed.success) return [];
    return parsed.data.subscriptions
      .filter((s) => GUID.test(s.id) && (!s.state || s.state === 'Enabled'))
      .map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        ...(s.tenantId && GUID.test(s.tenantId) && { tenant: s.tenantId }),
        isDefault: Boolean(s.isDefault),
      }));
  } catch {
    return [];
  }
}

/**
 * A resource's address, only when it's Microsoft's: https, and a host under
 * the domains Azure gives these resources. Anything else is refused, so a
 * token can't be sent somewhere else by a resource that names another host.
 */
export function azureEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port) return undefined;
    if (
      !/^[a-z0-9-]+\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/i.test(
        url.hostname,
      )
    )
      return undefined;
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

const Account = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  location: z.string().optional(),
  properties: z
    .object({
      endpoint: z.string().optional(),
      endpoints: z.record(z.string(), z.string()).optional(),
      provisioningState: z.string().optional(),
    })
    .optional(),
});

const Deployment = z.object({
  name: z.string(),
  properties: z
    .object({
      model: z
        .object({
          format: z.string().optional(),
          name: z.string().optional(),
          version: z.string().optional(),
        })
        .optional(),
      provisioningState: z.string().optional(),
    })
    .optional(),
});
export type AzureDeployment = z.infer<typeof Deployment>;

/** A resource Conch can talk to, and what it needs to. */
export interface AzureResource {
  account: CloudAccount;
  endpoint: string;
  subscription: string;
  tenant?: string;
}

/** A resource id as Azure writes them, safe to put in an address. */
const RESOURCE_ID =
  /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w.()-]{1,90}\/providers\/Microsoft\.CognitiveServices\/accounts\/[\w-]{2,64}$/i;

export class AzureCloud {
  #tokens = new Map<string, { value: string; until: number }>();
  #resources?: { value: AzureResource[]; at: number };

  constructor(private readonly deps: AzureDeps) {}

  #now() {
    return this.deps.now?.() ?? Date.now();
  }

  forget() {
    this.#tokens.clear();
    this.#resources = undefined;
  }

  async signedIn(): Promise<boolean> {
    return (await azureSubscriptions(this.deps)).length > 0;
  }

  /** A token for one of Azure's audiences, from the CLI, kept until a few minutes before it ends. */
  async token(resource: 'management' | 'cognitive', tenant?: string): Promise<string> {
    const audience = resource === 'management' ? MANAGEMENT : COGNITIVE;
    const id = `${audience}|${tenant ?? ''}`;
    const known = this.#tokens.get(id);
    if (known && known.until > this.#now()) return known.value;
    const result = await this.deps.exec.run(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        audience,
        ...(tenant && GUID.test(tenant) ? ['--tenant', tenant] : []),
        '--output',
        'json',
      ],
      { timeout: 60_000 },
    );
    if (result.code === 127)
      throw new CloudError(
        'missing-tool',
        'Conch uses the Azure CLI to sign in to Azure. Install it, and Conch carries on.',
        {
          need: 'azure-cli',
        },
      );
    if (result.code !== 0) {
      if (
        /az login|aadsts|expired|please run|refresh token|interaction_required|no subscription/i.test(
          result.stderr,
        )
      )
        throw new CloudError('signed-out', 'Your Azure sign-in has ended. Sign in to Azure again.');
      throw new CloudError(
        'failed',
        clean(result.stderr) || 'The Azure CLI didn’t hand Conch a token.',
      );
    }
    const Token = z.object({
      accessToken: z.string().min(20),
      expires_on: z.union([z.number(), z.string()]).optional(),
    });
    let parsed: z.infer<typeof Token>;
    try {
      parsed = Token.parse(JSON.parse(result.stdout));
    } catch {
      throw new CloudError('failed', 'The Azure CLI sent a token Conch didn’t understand.');
    }
    const ends = Number(parsed.expires_on) * 1000;
    const until = Number.isFinite(ends) && ends > 0 ? ends - 5 * 60_000 : this.#now() + 30 * 60_000;
    this.#tokens.set(id, { value: parsed.accessToken, until });
    return parsed.accessToken;
  }

  async #get(url: string, token: string): Promise<unknown> {
    if (!url.startsWith(`${MANAGEMENT}/`))
      throw new CloudError('failed', 'Conch only asks Azure itself.');
    const response = await (this.deps.fetch ?? globalThis.fetch)(url, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new CloudError('failed', 'Conch couldn’t reach Azure. Check your connection.');
    });
    if (response.status === 401)
      throw new CloudError('signed-out', 'Your Azure sign-in has ended. Sign in to Azure again.');
    if (!response.ok) throw new CloudError('failed', `Azure said no (${response.status}).`);
    return response.json().catch(() => undefined);
  }

  /**
   * Every Azure OpenAI and AI Foundry resource you can see, across your
   * subscriptions (the first eight), read with the management API.
   */
  async resources(options: { force?: boolean } = {}): Promise<AzureResource[]> {
    if (!options.force && this.#resources && this.#now() - this.#resources.at < 5 * 60_000)
      return this.#resources.value;
    const subscriptions = (await azureSubscriptions(this.deps)).slice(0, 8);
    const out: AzureResource[] = [];
    for (const subscription of subscriptions) {
      const token = await this.token('management', subscription.tenant);
      let next: string | undefined =
        `${MANAGEMENT}/subscriptions/${subscription.id}/providers/Microsoft.CognitiveServices/accounts?api-version=${API_VERSION}`;
      for (let page = 0; next && page < 5; page++) {
        const body = z
          .object({ value: z.array(z.unknown()).default([]), nextLink: z.string().optional() })
          .safeParse(await this.#get(next, token));
        if (!body.success) break;
        for (const raw of body.data.value) {
          const account = Account.safeParse(raw);
          if (!account.success || !RESOURCE_ID.test(account.data.id)) continue;
          const kind = account.data.kind ?? '';
          if (!/^(OpenAI|AIServices)$/i.test(kind)) continue;
          if (
            account.data.properties?.provisioningState &&
            account.data.properties.provisioningState !== 'Succeeded'
          )
            continue;
          const endpoints = account.data.properties?.endpoints ?? {};
          const endpoint =
            azureEndpoint(endpoints['OpenAI Language Model Instance API']) ??
            azureEndpoint(account.data.properties?.endpoint);
          if (!endpoint) continue;
          out.push({
            account: {
              id: account.data.id,
              label: account.data.name,
              detail: [
                /^openai$/i.test(kind) ? 'Azure OpenAI' : 'Azure AI Foundry',
                account.data.location,
                subscription.name,
              ]
                .filter(Boolean)
                .join(' · '),
              state: 'ready',
              kind: 'resource',
              ...(account.data.location && { region: account.data.location }),
              isDefault: subscription.isDefault,
              broad: false,
            },
            endpoint,
            subscription: subscription.id,
            ...(subscription.tenant && { tenant: subscription.tenant }),
          });
        }
        next = body.data.nextLink?.startsWith(`${MANAGEMENT}/`) ? body.data.nextLink : undefined;
      }
    }
    this.#resources = { value: out, at: this.#now() };
    return out;
  }

  /** A resource's deployments that are ready: what its model picker lists. */
  async deployments(resourceId: string, tenant?: string): Promise<AzureDeployment[]> {
    if (!RESOURCE_ID.test(resourceId))
      throw new CloudError('not-chosen', 'Choose an Azure resource again.');
    const token = await this.token('management', tenant);
    const body = z
      .object({ value: z.array(z.unknown()).default([]) })
      .safeParse(
        await this.#get(`${MANAGEMENT}${resourceId}/deployments?api-version=${API_VERSION}`, token),
      );
    if (!body.success) return [];
    return body.data.value.flatMap((raw) => {
      const deployment = Deployment.safeParse(raw);
      if (!deployment.success) return [];
      const state = deployment.data.properties?.provisioningState;
      return !state || state === 'Succeeded' ? [deployment.data] : [];
    });
  }

  /** `az login --use-device-code`: a code that works from any device. */
  signIn(update: (state: LoginState) => void): LoginHandle {
    return signIn(
      this.deps.exec,
      {
        program: 'az',
        args: ['login', '--use-device-code', '--output', 'none'],
        hosts: /(^|\.)(microsoft\.com|microsoftonline\.com|live\.com)$/,
        code: /\bcode ([A-Z0-9]{6,12})\b/,
        waiting:
          'Sign in to Azure on the page that opens with the code below. This updates by itself.',
        verify: async () => {
          this.forget();
          return this.signedIn();
        },
        done: 'Signed in to Azure.',
      },
      update,
    );
  }
}
